import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, ThreadItem } from "./types";

const h = vi.hoisted(() => ({
  complete: vi.fn(),
  getCard: vi.fn(),
  getThread: vi.fn(),
  createCardFromBody: vi.fn(),
  startCard: vi.fn(),
}));
vi.mock("./haiku", () => ({ complete: h.complete }));
vi.mock("./store", () => ({ getCard: h.getCard, getThread: h.getThread }));
vi.mock("./new-card", () => ({ createCardFromBody: h.createCardFromBody, startCard: h.startCard }));

import { continueInNewCard, handoffPrompt, summaryPrompt, touchedFiles, transcript } from "./handoff";

const card = { id: "c1", title: "Fix login", cwd: "/p", backend: "claude", permissionMode: "default", lastLine: "last words" } as unknown as Card;
const edit = (file: string, added: number, removed: number, symbols?: string[]): ThreadItem => ({
  kind: "tool", id: `${file}${added}`, name: "Edit", summary: file, at: 1, file, edit: { file, added, removed, lines: [], more: 0, symbols },
});
const items: ThreadItem[] = [
  { kind: "user", text: "fix login", at: 1 },
  { kind: "assistant", text: "on it", at: 2 },
  edit("a.ts", 3, 1, ["login"]),
  edit("a.ts", 2, 0, ["login", "logout"]),
  { kind: "tool", id: "r", name: "Read", summary: "b.ts", at: 3, file: "b.ts" },
  { kind: "tool", id: "w", name: "Write", summary: "c.ts", at: 3, file: "c.ts" },
];

beforeEach(() => vi.clearAllMocks());

describe("touchedFiles", () => {
  it("merges edits per file and skips reads", () => {
    expect(touchedFiles(items)).toEqual([
      { file: "a.ts", edits: 2, added: 5, removed: 1, symbols: ["login", "logout"] },
      { file: "c.ts", edits: 1, added: 0, removed: 0, symbols: [] },
    ]);
  });
});

describe("transcript", () => {
  it("lists messages and tools, keeping the newest part when long", () => {
    expect(transcript(items)).toContain("USER: fix login\nASSISTANT: on it\nTOOL Edit: a.ts");
    const long = transcript([{ kind: "user", text: "x".repeat(30_000) + "END", at: 1 }]);
    expect(long.startsWith("…")).toBe(true);
    expect(long.endsWith("END")).toBe(true);
  });
  it("is the tail of summaryPrompt", () => {
    expect(summaryPrompt(card, items)).toContain("Fix login");
  });
});

describe("handoffPrompt", () => {
  it("carries summary, files and the typed message", () => {
    const p = handoffPrompt(card, " done X ", touchedFiles(items), "now add tests");
    expect(p).toContain("done X");
    expect(p).toContain("- a.ts (+5/-1), login, logout");
    expect(p).toContain("- c.ts");
    expect(p).toContain("Next:\nnow add tests");
  });
  it("says so when nothing was edited or typed", () => {
    const p = handoffPrompt(card, "s", [], " ");
    expect(p).toContain("none edited yet");
    expect(p).toContain("Pick up where it left off.");
  });
});

describe("continueInNewCard", () => {
  beforeEach(() => {
    h.getCard.mockReturnValue(card);
    h.getThread.mockReturnValue(items);
    h.createCardFromBody.mockReturnValue({ id: "c2" });
  });
  it("starts a card in the same folder and CLI", async () => {
    h.complete.mockResolvedValue("SUMMARY");
    await expect(continueInNewCard("c1", "go")).resolves.toEqual({ id: "c2" });
    const body = h.createCardFromBody.mock.calls[0]?.[0] as { prompt: string };
    expect(body).toMatchObject({ cwd: "/p", backend: "claude", title: "Fix login (continued)" });
    expect(body.prompt).toContain("SUMMARY");
    expect(h.startCard).toHaveBeenCalledWith({ id: "c2" });
  });
  it("falls back to the last line when Haiku fails", async () => {
    h.complete.mockRejectedValue(new Error("nope"));
    await continueInNewCard("c1", "");
    expect((h.createCardFromBody.mock.calls[0]?.[0] as { prompt: string }).prompt).toContain("last words");
  });
  it("refuses an unknown card", async () => {
    h.getCard.mockReturnValue(undefined);
    await expect(continueInNewCard("zz", "")).rejects.toThrow("No such card");
  });
});
