// electron/server.cjs: the dev server supervisor. Mirrors the patterns from
// electron/keep-working-ipc.test.ts (no real Electron) and electron/restart-when-idle.test.ts
// (inject fetchImpl). The supervisor accepts `app` and `spawn` as optional parameters so this
// test never loads real Electron; the log file goes in a temp dir, so it never touches the
// user's server.log.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { startServer } from "./server.cjs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-supervisor-test-"));
process.env.WEFT_DATA = tmpDir;

// A minimal child_process.spawn fake. Each test gets a fresh queue of children it can drive exits on.
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 1234;
  killed = false;
  kill = vi.fn(() => {
    this.killed = true;
  });
}
let children: FakeChild[] = [];
const fakeSpawn = () => {
  const c = new FakeChild();
  children.push(c);
  return c;
};
const fakeApp = {
  isPackaged: false,
  getPath: (key: string) => (key === "logs" ? path.join(tmpDir, "logs") : tmpDir),
};

// A fake fetch: resolves when the test flips `serverAlive` true. The supervisor's waitForServer
// polls `${url}/api/cards` every 250 ms with a 120s timeout, so we make the first poll hang until
// the test releases it — this is how we control when `ready` flips to true.
let serverAlive = false;
const realFetch = globalThis.fetch;
globalThis.fetch = () => {
  if (!serverAlive) {
    return new Promise<Response>(() => {}); // hang forever
  }
  return Promise.resolve(new Response("{}", { status: 200 }));
};

afterEach(() => {
  children = [];
  serverAlive = false;
});

// The supervisor's spawn is the only thing creating children. last() asserts one exists (TS
// noUncheckedIndexedAccess makes `children[i]` `T | undefined`); the tests use it because every
// exit we drive is for the freshly-launched child, not a specific index.
function last(): FakeChild {
  const c = children[children.length - 1];
  if (!c) throw new Error("no child launched yet");
  return c;
}

function makeSupervisor() {
  const onStatus = vi.fn();
  const onFatal = vi.fn();
  const onMark = vi.fn();
  const onNotify = vi.fn();
  const handle = startServer({
    preferredPort: 1024,
    env: {},
    onStatus,
    onFatal,
    onMark,
    onNotify,
    app: fakeApp,
    spawn: fakeSpawn,
  });
  return { handle, onStatus, onFatal, onMark, onNotify };
}

// Helper: bring the supervisor to "ready" by flipping serverAlive and waiting one tick so the
// waitForServer poll can resolve.
async function markReady() {
  serverAlive = true;
  await new Promise((r) => setTimeout(r, 300));
}

// Helper: flip serverAlive, then return the resolved handle so tests can call .restart().
async function markReadyAndResolve(handle: Promise<Awaited<ReturnType<typeof startServer>>>) {
  serverAlive = true;
  return handle;
}

describe("startServer supervisor", () => {
  it("calls onMark('port') and onStatus on the first crash", async () => {
    const { handle, onStatus, onMark, onNotify } = makeSupervisor();
    await markReady();
    await handle;
    expect(onMark).toHaveBeenCalledWith("port");
    const first = children[0];
    if (!first) throw new Error("no first child");
    first.emit("exit", 143, null);
    expect(onStatus).toHaveBeenCalledWith("Restarting…");
    expect(onNotify).toHaveBeenCalledWith({ kind: "status", text: "Restarting…" });
  });

  it("after 4 crashes in 2 min, fires onFatal and onNotify({kind:'fatal'})", async () => {
    const { handle, onFatal, onNotify } = makeSupervisor();
    await markReady();
    await handle;
    for (let i = 0; i < 3; i++) {
      last().emit("exit", 143, null);
      await new Promise((r) => setTimeout(r, 600));
    }
    last().emit("exit", 143, null);
    expect(onFatal).toHaveBeenCalledTimes(1);
    const firstCall: unknown = onFatal.mock.calls[0]?.[0];
    expect(firstCall).toMatch(/stopped 4 times in two minutes/);
    expect(onNotify).toHaveBeenCalledWith({ kind: "fatal", text: expect.stringMatching(/stopped 4 times in two minutes/) as unknown });
  });

  it("a proc-swapped exit doesn't count toward the budget", async () => {
    const { handle, onFatal } = makeSupervisor();
    const resolved = await markReadyAndResolve(handle);
    const first = children[0];
    if (!first) throw new Error("no first child");
    serverAlive = true;
    const swap = resolved.restart();
    first.emit("exit", 143, null);
    await swap;
    for (let i = 0; i < 3; i++) {
      last().emit("exit", 143, null);
      await new Promise((r) => setTimeout(r, 600));
    }
    expect(onFatal).not.toHaveBeenCalled();
  });

  it("restart() clears crashes and relaunches", async () => {
    const { handle, onFatal } = makeSupervisor();
    const resolved = await markReadyAndResolve(handle);
    for (let i = 0; i < 3; i++) {
      last().emit("exit", 143, null);
      await new Promise((r) => setTimeout(r, 600));
    }
    const before = children.length;
    serverAlive = true;
    await resolved.restart();
    expect(children.length).toBeGreaterThan(before);
    for (let i = 0; i < 3; i++) {
      last().emit("exit", 143, null);
      await new Promise((r) => setTimeout(r, 600));
    }
    expect(onFatal).not.toHaveBeenCalled();
  });

  it("exposes wasReady on the handle after the server first responds", async () => {
    const { handle } = makeSupervisor();
    serverAlive = true;
    const resolved = await handle;
    expect(resolved.wasReady).toBe(true);
  });
});

afterAll(() => {
  globalThis.fetch = realFetch;
  // Wait a tick so the supervisor's writeStream has closed its file handle before we nuke the dir.
  return new Promise<void>((r) => setTimeout(r, 100)).then(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });
});


