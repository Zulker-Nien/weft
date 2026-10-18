// electron/terminal.cjs: the session ownership / isBoard gate the M-3 fix introduces. The real
// registerTerminal wires node-pty through Electron's ipcMain, which is heavy to spin up; the
// `sessionFor` helper it calls is a pure function over the sessions Map, sender id and an
// isBoard predicate, so this test covers the new gates without the heavy deps.
import { describe, expect, it, vi } from "vitest";
import { registerTerminal, sessionFor } from "./terminal.cjs";

describe("sessionFor", () => {
  it("returns null when the sender isn't the board window", () => {
    const sessions = new Map([["k", { ownerId: 1, proc: { write: () => {} } }]]);
    const isBoard = () => false;
    expect(sessionFor(sessions, isBoard, { id: 1 }, "k")).toBeNull();
  });

  it("returns null for a missing session id", () => {
    const sessions = new Map<string, { ownerId: number; proc: { write: () => void } }>();
    const isBoard = () => true;
    expect(sessionFor(sessions, isBoard, { id: 1 }, "missing")).toBeNull();
  });

  it("returns null when the sender isn't the owner (M-3 fix)", () => {
    const proc = { write: () => {} };
    const sessions = new Map([["k", { ownerId: 1, proc }]]);
    const isBoard = () => true;
    // Sender 2 is the board window but didn't open this id; the M-3 fix drops it.
    expect(sessionFor(sessions, isBoard, { id: 2 }, "k")).toBeNull();
  });

  it("returns the session when the sender opened it (the happy path)", () => {
    const proc = { write: () => {} };
    const sessions = new Map<string, { ownerId: number; proc: { write: () => void } }>([["k", { ownerId: 1, proc }]]);
    const isBoard = () => true;
    expect(sessionFor(sessions, isBoard, { id: 1 }, "k")).toBe(sessions.get("k"));
  });

  it("returns null when sender is missing", () => {
    const sessions = new Map<string, { ownerId: number; proc: { write: () => void } }>([["k", { ownerId: 1, proc: { write: () => {} } }]]);
    const isBoard = () => true;
    expect(sessionFor(sessions, isBoard, undefined, "k")).toBeNull();
  });
});

// The handlers themselves (pentest 2026-10-18, F-3): a sender that isn't the board window is turned away
// before node-pty is ever loaded, so a stray renderer can't open a shell.
describe("registerTerminal", () => {
  function fakeIpc() {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const add = (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn);
    return { handlers, ipcMain: { handle: add, on: add } };
  }

  it("refuses terminal:open from a sender that isn't the board", () => {
    const { handlers, ipcMain } = fakeIpc();
    const isBoard = vi.fn(() => false);
    registerTerminal(ipcMain, { isBoard });
    const sender = { id: 7 };
    expect(handlers.get("terminal:open")!({ sender }, "k", "/tmp", 80, 24)).toEqual({ error: "Terminal only answers the board window." });
    expect(isBoard).toHaveBeenCalledWith(sender);
  });

  it("drops write, resize and kill from a non-board sender without throwing", () => {
    const { handlers, ipcMain } = fakeIpc();
    registerTerminal(ipcMain, { isBoard: () => false });
    for (const channel of ["terminal:write", "terminal:resize", "terminal:kill"]) {
      expect(() => handlers.get(channel)!({ sender: { id: 7 } }, "k", "x", 1)).not.toThrow();
    }
  });
});
