// Updates: Weft checks GitHub Releases for a newer version at launch and every few hours.
//
// Each release carries update.json (scripts/release-feed.mjs writes it), in the static JSON format macOS's
// own updater (Squirrel.Mac, Electron's built-in autoUpdater) reads. A signed build hands the feed to
// Squirrel, which downloads the zip in the background; the app menu then offers "Restart to Update", and
// the update also lands on the next quit. An unsigned build, or any Squirrel failure, falls back to
// "Download Weft X…", which opens the release page. No restart happens without a click, and the click asks
// first when threads are running. Dev mode never checks on its own (`npm run desktop` updates with git pull).
const FEED = process.env.WEFT_UPDATE_FEED || "https://github.com/aimhuge/weft/releases/latest/download/update.json";
const RELEASES = "https://github.com/aimhuge/weft/releases";
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
const FIRST_CHECK_MS = 30_000; // after launch, out of the board's way
const BUSY = new Set(["checking", "downloading", "ready"]); // phases a new check would only disturb

// -1, 0 or 1 for semver-ish "1.2.3" strings; a prerelease ("1.2.3-beta.1") sorts before its release.
function compareVersions(a, b) {
  const split = (v) => {
    const [core, pre = ""] = String(v).replace(/^v/, "").split("-", 2);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

// The release a feed offers over `current`, or null when there's nothing newer (or the feed is malformed).
function newerRelease(feed, current) {
  const version = feed?.currentRelease;
  if (typeof version !== "string" || compareVersions(version, current) <= 0) return null;
  const entry = (feed.releases || []).find((r) => r?.version === version);
  return {
    version,
    notes: entry?.updateTo?.notes || "",
    page: typeof feed.page === "string" ? feed.page : `${RELEASES}/tag/v${version}`,
  };
}

// The app menu item for an update state, or null when there's nothing to say.
function menuItem(state, { install, download, check }) {
  switch (state.phase) {
    case "ready":
      return { label: `Restart to Update to ${state.version}`, click: install };
    case "downloading":
      return { label: `Downloading Weft ${state.version}…`, enabled: false };
    case "available":
      return { label: `Download Weft ${state.version}…`, click: download };
    case "checking":
      return { label: "Checking for Updates…", enabled: false };
    default:
      return { label: "Check for Updates…", click: check };
  }
}

function createUpdater({
  currentVersion,
  packaged,
  autoUpdater,
  fetchJson = async (url) => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`update feed: HTTP ${res.status}`);
    return res.json();
  },
  countRunning = async () => null,
  confirm = async () => true,
  tell = () => {},
  notify = () => {},
  openExternal = () => {},
  onBeforeInstall = () => {},
  onChange = () => {},
  feed = FEED,
  log = console,
}) {
  let state = { phase: "idle" };
  let timer = null;
  let squirrelReady = false;

  function set(next) {
    state = next;
    onChange(state);
  }

  function fallBack(release, err) {
    if (err) log.warn?.(`Weft updater: ${err.message || err}; offering the download instead`);
    set({ phase: "available", version: release.version, page: release.page });
  }

  // Hands the feed to Squirrel once; its events move the state from here on.
  function startSquirrel(release) {
    if (!squirrelReady) {
      squirrelReady = true;
      autoUpdater.on("update-downloaded", () => {
        set({ phase: "ready", version: state.version, page: state.page });
        notify(`Weft ${state.version} is ready`, "Restart Weft to update, or it updates the next time you quit.");
      });
      autoUpdater.on("error", (err) => {
        if (state.phase === "downloading") fallBack(state, err);
      });
      autoUpdater.on("before-quit-for-update", onBeforeInstall);
      autoUpdater.setFeedURL({ url: feed, serverType: "json" });
    }
    set({ phase: "downloading", version: release.version, page: release.page });
    try {
      autoUpdater.checkForUpdates();
    } catch (err) {
      fallBack(release, err);
    }
  }

  // `manual` is the menu's "Check for Updates…": it says what it found, even "you're up to date".
  async function check({ manual = false } = {}) {
    if (BUSY.has(state.phase)) return state;
    const say = manual ? tell : () => {};
    const before = state;
    set({ phase: "checking" });
    let release;
    try {
      release = newerRelease(await fetchJson(feed), currentVersion);
    } catch (err) {
      set(before.phase === "available" ? before : { phase: "idle" });
      say("Couldn't check for updates", String(err.message || err));
      return state;
    }
    if (!release) {
      set({ phase: "idle" });
      say("You're up to date", `Weft ${currentVersion} is the newest version.`);
      return state;
    }
    if (packaged && autoUpdater) startSquirrel(release);
    else fallBack(release);
    if (state.phase === "available") say(`Weft ${release.version} is out`, "Choose Download in the Weft menu to get it.");
    return state;
  }

  async function install() {
    if (state.phase !== "ready") return false;
    const running = await countRunning().catch(() => null);
    if (running > 0) {
      const what = running === 1 ? "1 thread is" : `${running} threads are`;
      if (!(await confirm(`${what} still running`, "Restarting stops them mid-turn. Restart and update anyway?"))) return false;
    }
    onBeforeInstall();
    autoUpdater.quitAndInstall();
    return true;
  }

  function download() {
    if (state.page) openExternal(state.page);
  }

  function start() {
    if (!packaged || timer) return;
    timer = setTimeout(function tick() {
      check().catch(() => {});
      timer = setTimeout(tick, CHECK_EVERY_MS);
    }, FIRST_CHECK_MS);
  }

  function stop() {
    clearTimeout(timer);
    timer = null;
  }

  return {
    check,
    install,
    download,
    start,
    stop,
    state: () => state,
    menuItem: () => menuItem(state, { install: () => install(), download, check: () => check({ manual: true }) }),
  };
}

// The updater with Electron's own pieces: Squirrel, dialogs, a notification, and the board's running count.
function createAppUpdater({ getServer, onChange }) {
  const { BaseWindow, Notification, app, autoUpdater, dialog, shell } = require("electron");
  return createUpdater({
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    autoUpdater,
    countRunning: async () => {
      const server = getServer();
      if (!server) return null;
      const { cards } = await (await fetch(`${server.url}/api/cards`)).json();
      return cards.filter((card) => card.column === "running").length;
    },
    confirm: async (message, detail) =>
      (await dialog.showMessageBox({ type: "question", message, detail, buttons: ["Restart and Update", "Not Now"], defaultId: 1, cancelId: 1 }))
        .response === 0,
    tell: (message, detail) => dialog.showMessageBox({ type: "info", message, detail }),
    notify: (title, body) => Notification.isSupported() && new Notification({ title, body }).show(),
    openExternal: (url) => shell.openExternal(url),
    // quitAndInstall closes every window first, and the board's close handler only hides it; destroying skips that.
    onBeforeInstall: () => BaseWindow.getAllWindows().forEach((w) => w.destroy()),
    onChange,
  });
}

module.exports = { createAppUpdater, createUpdater, compareVersions, newerRelease, menuItem, FEED, CHECK_EVERY_MS, FIRST_CHECK_MS };
