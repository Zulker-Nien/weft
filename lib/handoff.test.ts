import { describe, expect, it } from "vitest";
import type { Card, ThreadItem } from "./types";

import { summaryPrompt, touchedFiles, transcript } from "./handoff";

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
