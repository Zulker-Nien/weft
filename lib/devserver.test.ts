import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// spawn hands back a fake child the tests drive by emitting data, error and exit; fetch and
// process.kill are stubbed, so nothing really starts or gets signalled.
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
  constructor(public pid: number) {
    super();
  }
}

const children: FakeChild[] = [];
const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));

// Catch the exit hook the module installs instead of letting it reach the real process.
const exitHooks: (() => void)[] = [];
const realOn = process.on.bind(process);
vi.spyOn(process, "on").mockImplementation(((event: string, fn: () => void) => {
  if (event === "exit") exitHooks.push(fn);
  else realOn(event, fn);
  return process;
}) as typeof process.on);

// The vault's side is mocked: by default there's nothing to inject, so servers start the plain way.
const devSecrets = vi.hoisted(() => vi.fn());
vi.mock("./secret-run", () => ({ devSecrets }));
vi.mock("./env", () => ({ cliEnv: () => ({ PATH: "/bin" }) }));

const dev = await import("./devserver");

const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

let nextPid = 1000;
beforeEach(() => {
  spawn.mockReset().mockImplementation(() => {
    const child = new FakeChild(++nextPid);
    children.push(child);
    return child;
  });
  fetchMock.mockReset().mockRejectedValue(new Error("ECONNREFUSED"));
  devSecrets.mockReset().mockResolvedValue({});
  kill.mockClear();
});
afterEach(() => {
  for (const id of ["a", "b", "c"]) dev.stopDev(id);
  children.length = 0;
});

const last = () => children[children.length - 1]!;

describe("reachable", () => {
  it("is true when anything answers, without following redirects", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    expect(await dev.reachable("http://localhost:3000")).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000", expect.objectContaining({ redirect: "manual" }));
    expect(fetchMock.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
  });

  it("is false when the request fails", async () => {
    expect(await dev.reachable("http://localhost:3000")).toBe(false);
  });
});

describe("devStatus", () => {
  it("is stopped with no server and no url, and doesn't probe", async () => {
    expect(await dev.devStatus("a")).toEqual({ state: "stopped", command: undefined, reachable: false, log: "" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is running when the url answers even though Weft didn't start it", async () => {
    fetchMock.mockResolvedValue(new Response("ok"));
    expect(await dev.devStatus("a", "http://x")).toMatchObject({ state: "running", reachable: true });
  });

  it("is stopped when Weft didn't start it and the url doesn't answer", async () => {
    expect(await dev.devStatus("a", "http://x")).toMatchObject({ state: "stopped", reachable: false });
  });

  it("is starting while the server runs but doesn't answer yet, then running", async () => {
    await dev.startDev("a", "npm run dev", "/app");
    expect(await dev.devStatus("a", "http://x")).toMatchObject({ state: "starting", command: "npm run dev" });
    fetchMock.mockResolvedValue(new Response("ok"));
    expect(await dev.devStatus("a", "http://x")).toMatchObject({ state: "running", reachable: true });
  });

  it("is failed after a non-zero exit and stopped after a clean one", async () => {
    await dev.startDev("a", "bad", "/app");
    last().emit("exit", 1);
    expect((await dev.devStatus("a")).state).toBe("failed");

    await dev.startDev("b", "ok", "/app");
    last().emit("exit", 0);
    expect((await dev.devStatus("b")).state).toBe("stopped");

    await dev.startDev("c", "signalled", "/app");
    last().emit("exit", null);
    expect((await dev.devStatus("c")).state).toBe("stopped");
  });

  it("is failed when the shell can't spawn, with the error in the log", async () => {
    await dev.startDev("a", "nope", "/app");
    last().emit("error", new Error("spawn ENOENT"));
    expect(await dev.devStatus("a")).toMatchObject({ state: "failed", log: "spawn ENOENT" });
  });

  it("shows the last 12 lines the server printed, from stdout and stderr", async () => {
    await dev.startDev("a", "npm run dev", "/app");
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    last().stdout.emit("data", Buffer.from(`${lines.slice(0, 10).join("\n")}\n`));
    last().stderr.emit("data", Buffer.from(`${lines.slice(10).join("\n")}\n`));
    expect((await dev.devStatus("a")).log).toBe(lines.slice(8).join("\n"));
  });

  it("keeps only the last 4000 characters of output", async () => {
    await dev.startDev("a", "npm run dev", "/app");
    last().stdout.emit("data", Buffer.from("a".repeat(3000)));
    last().stdout.emit("data", Buffer.from("b".repeat(3000)));
    const { log } = await dev.devStatus("a");
    expect(log).toHaveLength(4000);
    expect(log).toBe("a".repeat(1000) + "b".repeat(3000));
  });
});

describe("startDev", () => {
  it("spawns the command in a detached shell in the card's folder", async () => {
    await dev.startDev("a", "npm run dev", "/app");
    expect(spawn).toHaveBeenCalledWith("npm run dev", { cwd: "/app", env: { PATH: "/bin" }, shell: true, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    expect(devSecrets).toHaveBeenCalledWith("a", "npm run dev", "/app");
  });

  it("starts through the secrets launcher when the vault has values, writing its request to stdin", async () => {
    const stdin = { end: vi.fn() };
    spawn.mockImplementationOnce(() => {
      const child = Object.assign(new FakeChild(++nextPid), { stdin });
      children.push(child);
      return child;
    });
    devSecrets.mockResolvedValueOnce({ launch: { bin: "/Electron", args: ["/app/secret-env.cjs"], env: { ELECTRON_RUN_AS_NODE: "1" }, stdin: '{"grant":"g"}', names: ["DATABASE_URL", "API_KEY"] } });
    await dev.startDev("a", "npm run dev", "/app");
    expect(spawn).toHaveBeenCalledWith("/Electron", ["/app/secret-env.cjs"], { cwd: "/app", env: { PATH: "/bin", ELECTRON_RUN_AS_NODE: "1" }, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    expect(stdin.end).toHaveBeenCalledWith('{"grant":"g"}');
    expect((await dev.devStatus("a")).log).toBe("With vault secrets: DATABASE_URL, API_KEY");
  });

  it("starts the plain way with the vault's note in the log", async () => {
    devSecrets.mockResolvedValueOnce({ note: "Started without vault secrets: not approved." });
    await dev.startDev("a", "npm run dev", "/app");
    expect((await dev.devStatus("a")).log).toBe("Started without vault secrets: not approved.");
  });

  it("leaves a running server with the same command alone", async () => {
    await dev.startDev("a", "npm run dev", "/app");
    await dev.startDev("a", "npm run dev", "/app");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
  });

  it("replaces a server started with another command, killing its process group", async () => {
    await dev.startDev("a", "npm run dev", "/app");
    const first = last();
    await dev.startDev("a", "pnpm dev", "/app");
    expect(kill).toHaveBeenCalledWith(-first.pid, "SIGTERM");
    expect(spawn).toHaveBeenCalledTimes(2);
    expect((await dev.devStatus("a")).command).toBe("pnpm dev");
  });

  it("restarts the same command once the old server has exited, without signalling it", async () => {
    await dev.startDev("a", "npm run dev", "/app");
    last().emit("exit", 0);
    await dev.startDev("a", "npm run dev", "/app");
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(kill).not.toHaveBeenCalled();
  });

  it("doesn't mark the new server failed when the replaced one exits non-zero", async () => {
    await dev.startDev("a", "one", "/app");
    const first = last();
    await dev.startDev("a", "two", "/app");
    first.emit("exit", 143);
    expect((await dev.devStatus("a")).state).toBe("starting");
  });
});

describe("stopDev", () => {
  it("does nothing for a card with no server", () => {
    dev.stopDev("nobody");
    expect(kill).not.toHaveBeenCalled();
  });

  it("forgets the server and kills its process group", async () => {
    await dev.startDev("a", "npm run dev", "/app");
    const child = last();
    dev.stopDev("a");
    expect(kill).toHaveBeenCalledWith(-child.pid, "SIGTERM");
    expect(child.kill).not.toHaveBeenCalled();
    expect(await dev.devStatus("a")).toMatchObject({ state: "stopped", command: undefined });
  });

  it("falls back to killing the shell when the group signal fails", async () => {
    await dev.startDev("a", "npm run dev", "/app");
    kill.mockImplementationOnce(() => {
      throw new Error("ESRCH");
    });
    dev.stopDev("a");
    expect(last().kill).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("on exit", () => {
  it("stops every server Weft started", async () => {
    expect(exitHooks).toHaveLength(1);
    await dev.startDev("a", "x", "/app");
    const a = last();
    await dev.startDev("b", "y", "/app");
    const b = last();
    exitHooks[0]!();
    expect(kill).toHaveBeenCalledWith(-a.pid, "SIGTERM");
    expect(kill).toHaveBeenCalledWith(-b.pid, "SIGTERM");
  });

  it("installs the hook only once per process, even when the module loads again", async () => {
    vi.resetModules();
    await import("./devserver");
    expect(exitHooks).toHaveLength(1);
  });
});
