// Keep Working: the Mac stays awake with the lid shut, so threads keep running in a bag.
//
// Shutting the lid forces sleep whatever caffeinate or powerSaveBlocker say; only `pmset disablesleep 1`
// overrides it. That needs root, so the first use installs a sudoers rule through macOS's own password
// dialog, allowing just `pmset -a disablesleep 0|1`. A detached watchdog puts sleep back at the deadline,
// at 10% battery, or when Weft itself is gone, so a crash can't leave the Mac unable to sleep. "Until
// threads finish" also turns it off once no card has been running for two checks in a row.
const { execFile, execFileSync, spawn } = require("node:child_process");
const { dialog } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PMSET = "/usr/bin/pmset";
const SUDO = "/usr/bin/sudo";
const SUDOERS = "/etc/sudoers.d/weft-keep-working";
const MIN_BATTERY = 10;
const THREADS_CAP_HOURS = 8;
const CHECK_MS = 60_000;
const IDLE_CHECKS = 2; // a gap between turns isn't the end of the work
const HOUR_CHOICES = [1, 2, 3, 8];

function sudoersLine(user) {
  return `${user} ALL=(root) NOPASSWD: ${PMSET} -a disablesleep 0, ${PMSET} -a disablesleep 1\n`;
}

function leftText(until, now) {
  const mins = Math.max(0, Math.round((until - now) / 60_000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m` : `${mins}m`;
}

// What the menu bar icon adds to its title: a cup, plus the hours left when on a timer.
function trayTitle(state, now) {
  if (state.mode === "off") return "";
  if (state.mode === "threads") return "☕︎";
  const mins = Math.max(0, Math.round((state.until - now) / 60_000));
  return `☕︎${mins >= 60 ? `${Math.floor(mins / 60)}h` : `${mins}m`}`;
}

function statusText(state, now) {
  if (state.mode === "off") return "Off: shutting the lid puts the Mac to sleep";
  if (state.mode === "threads") {
    const n = state.running;
    const what = n == null ? "" : n > 0 ? ` (${n} running)` : " (nothing running)";
    return `On until threads finish${what}`;
  }
  const at = new Date(state.until).toTimeString().slice(0, 5);
  return `On until ${at} (${leftText(state.until, now)} left)`;
}

// The tray's "Keep Working" submenu.
function menuTemplate(state, now, { start, stop }) {
  const on = (mode, hours) => state.mode === mode && (mode === "threads" || state.hours === hours);
  return {
    label: "Keep Working",
    submenu: [
      { label: statusText(state, now), enabled: false },
      { type: "separator" },
      { label: "Until threads finish", type: "checkbox", checked: on("threads"), click: () => start("threads") },
      ...HOUR_CHOICES.map((h) => ({
        label: h === 1 ? "For 1 hour" : `For ${h} hours`,
        type: "checkbox",
        checked: on("hours", h),
        click: () => start("hours", h),
      })),
      { type: "separator" },
      { label: "Off", enabled: state.mode !== "off", click: stop },
    ],
  };
}

// Puts sleep back at `until` (seconds), at low battery on battery power, or when Weft's pid is gone.
const WATCHDOG = `
until="$1"; min="$2"; pid="$3"; pmset="$4"
while [ "$(date +%s)" -lt "$until" ]; do
  sleep 30
  kill -0 "$pid" 2>/dev/null || break
  batt=$(pmset -g batt)
  pct=$(grep -Eo "[0-9]+%" <<<"$batt" | head -1 | tr -d %)
  if grep -q "Battery Power" <<<"$batt" && [ "\${pct:-100}" -le "$min" ]; then break; fi
done
/usr/bin/sudo -n "$pmset" -a disablesleep 0
`;

function run(file, args) {
  return new Promise((resolve) => execFile(file, args, (err, stdout, stderr) => resolve({ ok: !err, err, out: `${stdout}${stderr}`.trim() })));
}

// How many cards are in Running, or null when the server can't say.
async function countRunning(server) {
  if (!server) return null;
  try {
    const { cards } = await (await fetch(`${server.url}/api/cards`)).json();
    return cards.filter((card) => card.column === "running").length;
  } catch {
    return null;
  }
}

function createKeepWorking({ getServer, onChange }) {
  const notify = (message) => dialog.showMessageBox({ type: "warning", message });
  /** @type {{ mode: "off" | "threads" | "hours"; hours?: number; until?: number; running?: number | null }} */
  let state = { mode: "off" };
  let watchdog = null;
  let ticker = null;
  let idle = 0;
  // Subscribers fire on every state change; main.cjs forwards them to the board window over IPC
  // (one of the chips changed, the deadline ticked over, the watchdog restored sleep on its own).
  const subscribers = new Set();
  function fanout() {
    onChange();
    for (const cb of subscribers) {
      try { cb(); } catch (err) { console.error("keep-working subscriber:", err); }
    }
  }

  const set = (next) => {
    state = { ...next };
    fanout();
  };

  async function hasRule() {
    return (await run(SUDO, ["-n", "-l", PMSET, "-a", "disablesleep", "1"])).ok;
  }

  // Validates the rule as you, then installs it as root behind macOS's password dialog.
  async function installRule() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-keep-working-"));
    const file = path.join(dir, "rule");
    try {
      fs.writeFileSync(file, sudoersLine(os.userInfo().username));
      const check = await run("/usr/sbin/visudo", ["-cf", file]);
      if (!check.ok) throw new Error(`The sudoers rule didn't validate: ${check.out}`);
      const script =
        `do shell script "/usr/bin/install -m 0440 -o root -g wheel " & quoted form of "${file}" & " ${SUDOERS}" ` +
        `with administrator privileges with prompt "Weft needs permission, once, to keep your Mac awake with the lid shut."`;
      const res = await run("/usr/bin/osascript", ["-e", script]);
      if (!res.ok) {
        if (/-128/.test(res.out)) return false; // Cancel
        throw new Error(res.out || "osascript failed");
      }
      return true;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  function killWatchdog() {
    if (watchdog && watchdog.exitCode === null) {
      watchdog.removeAllListeners("exit");
      try {
        process.kill(watchdog.pid);
      } catch {}
    }
    watchdog = null;
  }

  function clearTicker() {
    clearInterval(ticker);
    ticker = null;
  }

  async function start(mode, hours) {
    try {
      if (!(await hasRule()) && !(await installRule())) return;
      const capHours = mode === "threads" ? THREADS_CAP_HOURS : hours;
      const until = Date.now() + capHours * 3_600_000;
      const res = await run(SUDO, ["-n", PMSET, "-a", "disablesleep", "1"]);
      if (!res.ok) throw new Error(res.out || "pmset failed");

      killWatchdog();
      watchdog = spawn("/bin/bash", ["-c", WATCHDOG, "weft-keep-working", String(Math.floor(until / 1000)), String(MIN_BATTERY), String(process.pid), PMSET], {
        detached: true,
        stdio: "ignore",
      });
      watchdog.unref();
      watchdog.on("exit", () => {
        watchdog = null;
        clearTicker();
        set({ mode: "off" });
      });

      idle = 0;
      clearTicker();
      ticker = setInterval(tick, CHECK_MS);
      set({ mode, hours, until, running: null });
      if (mode === "threads") void tick();
    } catch (err) {
      notify(`Keep Working couldn't start: ${err.message || err}`);
    }
  }

  async function tick() {
    if (state.mode === "threads") {
      const running = await countRunning(getServer());
      if (state.mode !== "threads") return;
      idle = running === 0 ? idle + 1 : 0;
      if (idle >= IDLE_CHECKS) return stop();
      set({ ...state, running });
    } else {
      fanout(); // the hours left in the menu bar
    }
  }

  async function stop() {
    killWatchdog();
    clearTicker();
    const res = await run(SUDO, ["-n", PMSET, "-a", "disablesleep", "0"]);
    if (!res.ok) notify(`Keep Working couldn't turn sleep back on: ${res.out}. Run: sudo pmset -a disablesleep 0`);
    set({ mode: "off" });
  }

  // On quit: sleep comes back before Weft is gone.
  function stopSync() {
    if (state.mode === "off") return;
    killWatchdog();
    clearTicker();
    try {
      execFileSync(SUDO, ["-n", PMSET, "-a", "disablesleep", "0"], { stdio: "ignore", timeout: 5000 });
    } catch {}
    state = { mode: "off" };
  }

  return {
    title: () => trayTitle(state, Date.now()),
    menu: () => menuTemplate(state, Date.now(), { start, stop }),
    start,
    stop,
    // The card in Settings reads this; it mirrors the shape of the internal state and is safe to send
    // over IPC (only primitives, no Electron handles).
    state: () => ({ ...state }),
    // Returns the unsubscribe. main.cjs uses this to forward changes to the board window over IPC.
    subscribe: (cb) => { subscribers.add(cb); return () => subscribers.delete(cb); },
    stopSync,
  };
}

module.exports = { createKeepWorking, HOUR_CHOICES, menuTemplate, statusText, sudoersLine, trayTitle };
