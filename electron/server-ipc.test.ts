// electron/server-ipc.cjs: the board's only door to the dev server supervisor. Mirrors the
// pattern in electron/keep-working-ipc.test.ts — fake ipcMain, fake board webContents, and the
// supervisor handle is a stub. shell is injected the same way as the IPC files' other deps so we
// don't have to load real Electron.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import registerServerIpc from "./server-ipc.cjs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-server-ipc-test-"));
const logFile = path.join(tmpDir, "server.log");
fs.writeFileSync(logFile, "fake log content\n");

function setup(opts: { hasServer?: boolean; hasHandleLink?: boolean } = {}) {
  const handlers = new Map<string, (e: unknown, payload?: unknown) => unknown>();
  const ipcMain = {
    handle: (channel: string, fn: (e: unknown, payload?: unknown) => unknown) =>
      handlers.set(channel, fn),
  };
  const board = { isDestroyed: () => false };
  const restart = vi.fn(async () => {});
  const server = opts.hasServer === false ? null : { restart };
  const handleLink = opts.hasHandleLink === false ? null : vi.fn();
  const showItemInFolder = vi.fn();
  const shell = { showItemInFolder };
  registerServerIpc({
    ipcMain,
    getServer: () => server as never,
    getBoardContents: () => board as never,
    getHandleLink: () => handleLink as never,
    logPath: () => logFile,
    shell: shell as never,
  });
  return { handlers, board, restart, handleLink, showItemInFolder };
}

describe("registerServerIpc", () => {
  it("server:retry calls the supervisor's restart and resolves", async () => {
    const { handlers, board, restart } = setup();
    const res = await handlers.get("server:retry")!({ sender: board });
    expect(restart).toHaveBeenCalled();
    expect(res).toEqual({ ok: true });
  });

  it("server:log-tail returns the file's content", () => {
    const { handlers, board } = setup();
    const tail = handlers.get("server:log-tail")!({ sender: board });
    expect(tail).toBe("fake log content\n");
  });

  it("server:open-logs reveals the log file in Finder", async () => {
    const { handlers, board, showItemInFolder } = setup();
    await handlers.get("server:open-logs")!({ sender: board });
    expect(showItemInFolder).toHaveBeenCalledWith(logFile);
  });

  it("weft:create-fix-card queues a weft://new link with the log tail in the prompt", () => {
    const { handlers, board, handleLink } = setup();
    handlers.get("weft:create-fix-card")!({ sender: board });
    expect(handleLink).toHaveBeenCalled();
    const url = (handleLink as unknown as { mock: { calls: [string][] } }).mock.calls[0]?.[0];
    if (typeof url !== "string") throw new Error("expected handleLink to be called with a string");
    expect(url).toMatch(/^weft:\/\/new\?/);
    const params = new URLSearchParams(url.slice("weft://new?".length));
    expect(params.get("title")).toBe("Fix the dev server");
    expect(params.get("folder")).toBe(path.resolve(__dirname, ".."));
    expect(params.get("prompt")).toContain("fake log content");
  });

  it("rejects every channel from a non-board sender", async () => {
    const { handlers, restart, showItemInFolder } = setup();
    const stranger = { sender: { id: 99 } };
    await handlers.get("server:retry")!(stranger);
    expect(restart).not.toHaveBeenCalled();
    expect(handlers.get("server:log-tail")!(stranger)).toBe("");
    await handlers.get("server:open-logs")!(stranger);
    expect(showItemInFolder).not.toHaveBeenCalled();
    expect(handlers.get("weft:create-fix-card")!(stranger)).toBeUndefined();
  });

  it("weft:create-fix-card is a no-op without a handleLink", () => {
    const { handlers, board } = setup({ hasHandleLink: false });
    expect(() => handlers.get("weft:create-fix-card")!({ sender: board })).not.toThrow();
  });
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});
