// electron/keep-working-ipc.cjs: the Keep Working IPC answers the board window only (pentest
// 2026-10-18, F-4). A fake ipcMain records the handlers; the keepWorking stub records what got through.
import { describe, expect, it, vi } from "vitest";
import registerKeepWorkingIpc from "./keep-working-ipc.cjs";

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = { handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn) };
  const board = { isDestroyed: () => false, send: vi.fn() };
  let listener = () => {};
  const keepWorking = {
    state: vi.fn(() => ({ on: false })),
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    subscribe: (fn: () => void) => (listener = fn),
  };
  registerKeepWorkingIpc({ ipcMain, keepWorking, getBoardContents: () => board });
  return { handlers, board, keepWorking, notify: () => listener() };
}

describe("registerKeepWorkingIpc", () => {
  it("answers the board window", async () => {
    const { handlers, board, keepWorking } = setup();
    expect(handlers.get("keep-working:state")!({ sender: board })).toEqual({ on: false });
    await handlers.get("keep-working:start")!({ sender: board }, "hours", 2);
    handlers.get("keep-working:stop")!({ sender: board });
    expect(keepWorking.start).toHaveBeenCalledWith("hours", 2);
    expect(keepWorking.stop).toHaveBeenCalled();
  });

  it("ignores every channel from another sender", async () => {
    const { handlers, keepWorking } = setup();
    const stranger = { sender: { id: 99 } };
    expect(handlers.get("keep-working:state")!(stranger)).toBeNull();
    await handlers.get("keep-working:start")!(stranger, "threads");
    handlers.get("keep-working:stop")!(stranger);
    handlers.get("keep-working:stop")!({});
    expect(keepWorking.state).not.toHaveBeenCalled();
    expect(keepWorking.start).not.toHaveBeenCalled();
    expect(keepWorking.stop).not.toHaveBeenCalled();
  });

  it("still refuses an unknown mode from the board", async () => {
    const { handlers, board, keepWorking } = setup();
    await handlers.get("keep-working:start")!({ sender: board }, "forever");
    expect(keepWorking.start).not.toHaveBeenCalled();
  });

  it("pushes changes to the board", () => {
    const { board, notify } = setup();
    notify();
    expect(board.send).toHaveBeenCalledWith("keep-working:changed");
  });

  it("does nothing without keepWorking", () => {
    const handle = vi.fn();
    registerKeepWorkingIpc({ ipcMain: { handle }, keepWorking: null, getBoardContents: () => null });
    expect(handle).not.toHaveBeenCalled();
  });
});
