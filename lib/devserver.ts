import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { DevServerStatus } from "./types";
import { cliEnv } from "./env";
import { globalSingleton } from "./global-singleton";
import { devSecrets } from "./secret-run";

// The dev server a card's review tour points at: started from the card's folder, kept running
// while the user reviews, and probed so the board can say whether the app really answers.
interface Run {
  child: ChildProcess;
  command: string;
  log: string;
  exited: boolean;
  failed: boolean;
}

const g = globalThis as unknown as { __threadboardDevExit?: boolean };
const runs = globalSingleton("__threadboardDevServers", () => new Map<string, Run>());

const LOG_LIMIT = 4000;

// Anything that answers HTTP counts as up, a 404 or redirect included.
export async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000), redirect: "manual" });
    return true;
  } catch {
    return false;
  }
}

export async function devStatus(cardId: string, url?: string): Promise<DevServerStatus> {
  const run = runs.get(cardId);
  const up = url ? await reachable(url) : false;
  const state = !run ? (up ? "running" : "stopped") : run.exited ? (run.failed ? "failed" : "stopped") : up ? "running" : "starting";
  return { state, command: run?.command, reachable: up, log: run?.log.trim().split("\n").slice(-12).join("\n") ?? "" };
}

export function stopDev(cardId: string) {
  const run = runs.get(cardId);
  if (!run) return;
  runs.delete(cardId);
  if (run.exited) return;
  // The shell leads a process group, so one signal takes down the server and whatever it spawned.
  try {
    if (run.child.pid === undefined) run.child.kill("SIGTERM");
    else process.kill(-run.child.pid, "SIGTERM");
  } catch {
    run.child.kill("SIGTERM");
  }
}

// With a vault for the folder, the server gets its development values in its env (lib/secret-run.ts), never
// this server's or a thread's; the user approves the command the first time.
export async function startDev(cardId: string, command: string, cwd: string) {
  const existing = runs.get(cardId);
  if (existing && !existing.exited && existing.command === command) return;
  const { launch, note } = await devSecrets(cardId, command, cwd);
  stopDev(cardId);
  // cliEnv() drops the pane's control-server token, which a dev server has no use for.
  const env = { ...cliEnv(), ...launch?.env };
  // (A plain start ignores stdin, so its stdin is null; only the secrets launch writes to it.)
  const child = (
    launch
      ? spawn(launch.bin, launch.args, { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] })
      : spawn(command, { cwd, env, shell: true, detached: true, stdio: ["ignore", "pipe", "pipe"] })
  ) as ChildProcessWithoutNullStreams;
  if (launch) child.stdin.end(launch.stdin);
  const run: Run = { child, command, log: launch ? `With vault secrets: ${launch.names.join(", ")}\n` : note ? `${note}\n` : "", exited: false, failed: false };
  const collect = (chunk: Buffer) => {
    run.log = (run.log + chunk.toString()).slice(-LOG_LIMIT);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.on("error", (err) => {
    run.log += `\n${err.message}`;
    run.exited = run.failed = true;
  });
  child.on("exit", (code) => {
    run.exited = true;
    run.failed = code !== 0 && code !== null && runs.get(cardId) === run;
  });
  runs.set(cardId, run);
}

// Servers Weft started shouldn't outlive it.
if (!g.__threadboardDevExit) {
  g.__threadboardDevExit = true;
  process.on("exit", () => {
    for (const id of [...runs.keys()]) stopDev(id);
  });
}
