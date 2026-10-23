// Keep Working's words: the sudoers rule, the menu bar title, the status line and the tray's submenu
// (electron/keep-working.cjs drives the state behind them).
const PMSET = "/usr/bin/pmset";
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
  if (state.mode === "off") return state.auto ? "Off: turns on when a thread runs" : "Off: shutting the lid puts the Mac to sleep";
  if (state.mode === "threads") {
    const n = state.running;
    const what = n == null ? "" : n > 0 ? ` (${n} running)` : " (nothing running)";
    return `On until threads finish${what}`;
  }
  const at = new Date(state.until).toTimeString().slice(0, 5);
  return `On until ${at} (${leftText(state.until, now)} left)`;
}

// The tray's "Keep Working" submenu.
/**
 * @param {{ mode: string; hours?: number; until?: number; running?: number | null; auto?: boolean }} state
 * @param {number} now
 * @param {{ start: Function; stop: Function; setAuto?: Function }} actions
 */
function menuTemplate(state, now, { start, stop, setAuto }) {
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
      { label: "Always while threads run", type: "checkbox", checked: Boolean(state.auto), click: () => setAuto?.(!state.auto) },
      { type: "separator" },
      { label: "Off", enabled: state.mode !== "off", click: stop },
    ],
  };
}

module.exports = { HOUR_CHOICES, menuTemplate, statusText, sudoersLine, trayTitle };
