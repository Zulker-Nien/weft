import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cliEnv } from "./env";
import { publish } from "./bus";
import type { Backend, LoginState, LoginTrial, LoginView } from "./types";
import { globalSingleton } from "./global-singleton";
import { openLoginInTerminal } from "./login-terminal";
import { authStatus } from "./login-status";

// Runs `<cli> auth login` in the background when a thread finds its CLI logged out, streams the
// CLI's output to the board's login pop-up, and falls back to a Terminal window when the CLI
// needs a real TTY (the macOS Terminal path lives in ./login-terminal).

const COMMANDS: Record<Backend, string> = { claude: "claude", puku: "puku-cli", codex: "codex" };
const OUTPUT_BYTES = 8 * 1024;
// Raw output kept for re-cleaning, so escape codes split across chunks still strip cleanly.
const RAW_BYTES = 32 * 1024;
const PUBLISH_MS = 200;
export const POLL_MS = 3_000;
export const TERMINAL_WAIT_MS = 10 * 60_000;

interface LoginRun {
  view: LoginView;
  raw: string;
  child?: ChildProcess;
  poll?: ReturnType<typeof setInterval>;
  polling: boolean;
  // Called once, when the CLI reports it's logged in.
  onDone: (() => void)[];
  publishTimer?: ReturnType<typeof setTimeout>;
  lastPublish: number;
}

// Kept on globalThis so dev-mode reloads don't lose a login in progress.
export const runs = globalSingleton("__threadboardLogins", () => new Map<Backend, LoginRun>());

const binaries = new Map<Backend, string>();

export function binary(backend: Backend) {
  let path = binaries.get(backend);
  if (!path) {
    const command = COMMANDS[backend];
    try {
      path = execFileSync("/usr/bin/which", [command], { encoding: "utf8" }).trim();
    } catch {
      path = "";
    }
    if (!path) throw new Error(`${command} isn't on this app's PATH, so it can't log in.`);
    binaries.set(backend, path);
  }
  return path;
}

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

// Exported for ./login-status, which reuses these helpers.
export { message, clean as cleanOutput };

// --- Output ---------------------------------------------------------------------------------

const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g;
const CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const OTHER_ESCAPE = /\x1b[ -/]*[0-~]?/g;
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const OSC8_URL = /\x1b\]8;[^;\x07\x1b]*;(https:\/\/[^\x07\x1b\s]+)/g;
const PLAIN_URL = /https:\/\/[^\s"'<>`]+/g;

function clean(raw: string) {
  return raw
    .replace(OSC, "")
    .replace(CSI, "")
    .replace(OTHER_ESCAPE, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(CONTROL, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

// The login page: a terminal hyperlink's target if the CLI printed one (it survives line
// wrapping), otherwise the last plain https URL in the output.
function lastUrl(raw: string, text: string) {
  const linked = [...raw.matchAll(OSC8_URL)].map((m) => m[1]);
  const plain = text.match(PLAIN_URL) ?? [];
  const url = linked.at(-1) ?? plain.at(-1);
  return url?.replace(/[)\].,;:!?'"]+$/, "");
}

function refresh(run: LoginRun) {
  const text = clean(run.raw);
  run.view.output = text.length > OUTPUT_BYTES ? text.slice(-OUTPUT_BYTES) : text;
  const url = lastUrl(run.raw, text);
  if (url) run.view.url = url;
}

function snapshot(run: LoginRun): LoginView {
  refresh(run);
  return { ...run.view };
}

export function append(run: LoginRun, chunk: string) {
  run.raw += chunk;
  if (run.raw.length > RAW_BYTES) run.raw = run.raw.slice(-RAW_BYTES);
}

export function isCurrent(run: LoginRun) {
  return runs.get(run.view.backend) === run;
}

// Read fresh each time: the state can change across an await.
function stillRunning(run: LoginRun) {
  return isCurrent(run) && run.view.state === "running";
}

export function emit(run: LoginRun) {
  if (run.publishTimer) {
    clearTimeout(run.publishTimer);
    run.publishTimer = undefined;
  }
  run.lastPublish = Date.now();
  if (isCurrent(run)) publish({ type: "login", login: snapshot(run) });
}

// Output arrives in bursts; publish at most every PUBLISH_MS.
function emitSoon(run: LoginRun) {
  if (run.publishTimer) return;
  const wait = Math.max(0, PUBLISH_MS - (Date.now() - run.lastPublish));
  run.publishTimer = setTimeout(() => emit(run), wait);
}

// --- Lifecycle ------------------------------------------------------------------------------

export function stopPolling(run: LoginRun) {
  if (run.poll) clearInterval(run.poll);
  run.poll = undefined;
}

function killChild(run: LoginRun) {
  const child = run.child;
  run.child = undefined;
  if (child && child.exitCode === null && child.signalCode === null) child.kill();
}

// Stops whatever a run is doing and hands back the callbacks still waiting on a login.
function retire(run: LoginRun | undefined) {
  if (!run) return [];
  stopPolling(run);
  killChild(run);
  if (run.publishTimer) clearTimeout(run.publishTimer);
  run.publishTimer = undefined;
  return run.onDone.splice(0);
}

export function newRun(backend: Backend, state: LoginState, onDone?: () => void): LoginRun {
  const inherited = retire(runs.get(backend));
  const run: LoginRun = {
    view: { backend, state, output: "", startedAt: Date.now() },
    raw: "",
    polling: false,
    onDone: onDone ? [...inherited, onDone] : inherited,
    lastPublish: 0,
  };
  runs.set(backend, run);
  return run;
}

function setState(run: LoginRun, state: LoginState) {
  run.view.state = state;
  emit(run);
}

export function succeed(run: LoginRun) {
  stopPolling(run);
  killChild(run);
  setState(run, "done");
  for (const callback of run.onDone.splice(0)) {
    try {
      callback();
    } catch (err) {
      console.error("[login] onDone callback failed:", err);
    }
  }
}

export function failRun(run: LoginRun, note?: string) {
  stopPolling(run);
  killChild(run);
  if (note) append(run, `\n${note}\n`);
  setState(run, "failed");
}

export function addCallback(run: LoginRun, onDone?: () => void) {
  if (onDone) run.onDone.push(onDone);
  return snapshot(run);
}

// Ink-based logins can refuse to start without a terminal.
function needsTty(text: string) {
  return /raw mode is not supported|not a tty|isn't a tty|setRawMode|inappropriate ioctl|stdin is not a terminal|ERR_TTY/i.test(
    text,
  );
}

async function onExit(run: LoginRun, child: ChildProcess, code: number | null, signal: NodeJS.Signals | null) {
  // Superseded, cancelled, or switched to Terminal while this process was running.
  if (run.child !== child || !isCurrent(run) || run.view.state !== "running") return;
  run.child = undefined;
  emit(run);

  const status = await authStatus(run.view.backend);
  if (!stillRunning(run)) return;

  if (status.loggedIn) {
    succeed(run);
  } else if (needsTty(clean(run.raw))) {
    append(run, "\nThe CLI needs a terminal for this login, so it's opening in Terminal.\n");
    openLoginInTerminal(run.view.backend);
  } else {
    failRun(run, signal ? `auth login stopped (${signal}).` : `auth login exited with code ${code ?? "unknown"}.`);
  }
}

export function isNotLoggedInError(text: string): boolean {
  return /not logged in|not authenticated|please run (?:\/login|codex login)|invalid api key|oauth token has expired|authentication_error/i.test(text);
}

// Distinct from a transient error or a not-logged-in: when the CLI's last turn hit the
// plan's rate limit, the card menu offers a one-click switch to the other backend.
export function isRateLimitError(text: string): boolean {
  return /rate.?limit|hit your limit|usage limit|limit reached|limit exceeded/i.test(text);
}

export function startLogin(backend: Backend, onDone?: () => void): LoginView {
  const existing = runs.get(backend);
  if (existing && (existing.view.state === "running" || existing.view.state === "terminal")) {
    return addCallback(existing, onDone);
  }

  // Codex login requires an interactive terminal for browser/device authorization.
  if (backend === "codex") return openLoginInTerminal(backend, onDone);

  const bin = binary(backend);
  const run = newRun(backend, "running", onDone);
  const child = spawn(bin, ["auth", "login"], { env: cliEnv(), stdio: ["pipe", "pipe", "pipe"] });
  run.child = child;

  const onData = (chunk: Buffer) => {
    if (!isCurrent(run)) return;
    append(run, chunk.toString("utf8"));
    emitSoon(run);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  // Writing a code after the CLI exits shouldn't crash the server.
  child.stdin.on("error", () => {});

  child.on("error", (err) => {
    if (run.child !== child || !isCurrent(run)) return;
    append(run, `\n${err.message}\n`);
    // The process never started, so no "close" follows.
    if (child.pid === undefined) {
      run.child = undefined;
      failRun(run);
    } else {
      emitSoon(run);
    }
  });
  child.on("close", (code, signal) => {
    void onExit(run, child, code, signal).catch((err: unknown) => {
      if (stillRunning(run)) failRun(run, message(err));
    });
  });

  emit(run);
  return snapshot(run);
}

// Notes on the login in progress why Weft's Puku trial didn't cover it, so the pop-up can offer Weft sign-in.
export function noteTrial(backend: Backend, trial: LoginTrial): void {
  const run = runs.get(backend);
  if (!run) return;
  run.view.trial = trial;
  emit(run);
}

export function sendLoginInput(backend: Backend, text: string): void {
  const run = runs.get(backend);
  const stdin = run?.view.state === "running" ? run.child?.stdin : undefined;
  if (!stdin || !stdin.writable) throw new Error("No login is waiting for a code right now.");
  stdin.write(`${text}\n`);
}

export function cancelLogin(backend: Backend): void {
  const run = runs.get(backend);
  if (!run) return;
  retire(run);
  if (run.view.state === "running" || run.view.state === "terminal") setState(run, "cancelled");
}

export { openLoginInTerminal };
export { authStatus };

export function loginRuns(): LoginView[] {
  return [...runs.values()].map(snapshot);
}
