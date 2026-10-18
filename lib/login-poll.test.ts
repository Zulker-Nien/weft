// The polling-on-exit behaviour of lib/login.ts lives here so the larger
// lib/login.test.ts can stay under its lint line ceiling. Same scaffolding
// (faked `auth status`, a stand-in child, an in-memory bus) is rebuilt below.

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoginView } from "./types";

type Callback = (err: Error | null, stdout: string, stderr: string) => void;

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), { writable: true, write: vi.fn() });
  pid: number | undefined = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kill = vi.fn();
}

const cp = vi.hoisted(() => ({
  which: vi.fn<(file: string, args: string[]) => string>(),
  spawn: vi.fn<() => FakeChild>(),
  children: [] as FakeChild[],
  status: vi.fn<(cb: Callback) => void>(),
  execFile: vi.fn(),
}));
const bus = vi.hoisted(() => ({ publish: vi.fn() }));

vi.mock("node:child_process", () => ({
  execFileSync: (file: string, args: string[]) => cp.which(file, args),
  spawn: () => cp.spawn(),
  execFile: (file: string, args: string[], _opts: unknown, cb: Callback) => {
    cp.execFile(file, args, _opts);
    cp.status(cb);
  },
}));
vi.mock("./bus", () => ({ publish: bus.publish }));

let login: typeof import("./login");
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;

function setPlatform(value: string) {
  Object.defineProperty(process, "platform", { ...platform, value });
}

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function lastPublished(): LoginView | undefined {
  return bus.publish.mock.calls.map(([event]) => (event as { login: LoginView }).login).at(-1);
}

function child() {
  return cp.children.at(-1)!;
}

function statusSays(stdout: string) {
  cp.status.mockImplementation((cb) => cb(null, stdout, ""));
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  delete (globalThis as { __weftLogins?: unknown }).__weftLogins;
  cp.children = [];
  cp.which.mockReset().mockImplementation((_file, [command]) => `/usr/local/bin/${command}\n`);
  cp.spawn.mockReset().mockImplementation(() => {
    const c = new FakeChild();
    cp.children.push(c);
    return c;
  });
  cp.status.mockReset();
  statusSays('{"loggedIn":false}');
  cp.execFile.mockReset();
  bus.publish.mockReset();
  setPlatform("darwin");
  login = await import("./login");
});

afterEach(() => {
  Object.defineProperty(process, "platform", platform);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("post-exit polling", () => {
  it("polls auth status after a clean exit and succeeds when the credential appears", async () => {
    const onDone = vi.fn();
    let calls = 0;
    cp.status.mockImplementation((cb) => {
      calls += 1;
      const body = calls >= 3 ? '{"loggedIn":true}' : '{"loggedIn":false}';
      cb(null, body, "");
    });

    login.startLogin("claude", onDone);
    child().emit("close", 0, null);
    await flush();

    // onExit's immediate check, the startPolling immediate tick, then the
    // one interval tick that sees the credential.
    expect(lastPublished()?.state).toBe("running");
    await vi.advanceTimersByTimeAsync(login.POLL_MS);
    await flush();

    expect(lastPublished()?.state).toBe("done");
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(cp.status).toHaveBeenCalledTimes(3);
  });

  it("gives up after the poll timeout when the credential never appears", async () => {
    statusSays('{"loggedIn":false}');

    login.startLogin("claude");
    child().emit("close", 0, null);
    await flush();

    // Four interval ticks of 3 s = 12 s, past the 10 s deadline.
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(login.POLL_MS);
      await flush();
    }

    expect(lastPublished()?.state).toBe("failed");
    expect(lastPublished()?.output).toContain("auth login exited but the CLI still reports logged out");
  });

  it("stops polling and stays cancelled when the login is cancelled mid-poll", async () => {
    statusSays('{"loggedIn":false}');

    login.startLogin("claude");
    child().emit("close", 0, null);
    await flush();

    login.cancelLogin("claude");
    expect(lastPublished()?.state).toBe("cancelled");
    const callsBefore = cp.status.mock.calls.length;

    await vi.advanceTimersByTimeAsync(login.POLL_MS * 2);
    await flush();

    expect(cp.status.mock.calls.length).toBe(callsBefore);
    expect(lastPublished()?.state).toBe("cancelled");
  });

  it("keeps polling past a few logged-out results before the credential appears", async () => {
    const onDone = vi.fn();
    let calls = 0;
    cp.status.mockImplementation((cb) => {
      calls += 1;
      const body = calls >= 3 ? '{"loggedIn":true}' : '{"loggedIn":false}';
      cb(null, body, "");
    });

    login.startLogin("claude", onDone);
    child().emit("close", 0, null);
    await flush();
    expect(lastPublished()?.state).toBe("running");

    await vi.advanceTimersByTimeAsync(login.POLL_MS);
    await flush();
    expect(lastPublished()?.state).toBe("done");
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
