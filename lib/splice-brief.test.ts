import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, ThreadItem } from "./types";

const h = vi.hoisted(() => ({
  complete: vi.fn(),
  getCard: vi.fn(),
  getThread: vi.fn(() => [] as ThreadItem[]),
  scopedDiff: vi.fn(() => ""),
}));
vi.mock("./haiku", () => ({ complete: h.complete }));
vi.mock("./store", () => ({ getCard: h.getCard, getThread: h.getThread }));
vi.mock("./splice-diff", () => ({ scopedDiff: h.scopedDiff }));

import { bakedSummary, briefFor, briefText, prebakeBrief } from "./splice-brief";

const cache = { at: 100, ttl: 300, hit: 90, tokens: 83_000 };
const card = (over: Partial<Card> = {}) => ({ id: "c1", title: "Fix login", cwd: "/p", lastLine: "last words", stats: { cache }, ...over }) as unknown as Card;
const edit: ThreadItem = { kind: "tool", id: "e", name: "Edit", summary: "a.ts", at: 1, file: "a.ts", edit: { file: "a.ts", added: 2, removed: 1, lines: [], more: 0 } };

beforeEach(() => {
  vi.clearAllMocks();
  h.getThread.mockReturnValue([]);
  h.scopedDiff.mockReturnValue("");
});

describe("briefText", () => {
  it("wraps the summary, what's open, the files and the diff in a reminder, with room for the message", () => {
    const files = [{ file: "a.ts", edits: 1, added: 2, removed: 1, symbols: [] }, { file: "b.ts", edits: 1, added: 0, removed: 0, symbols: [] }];
    const text = briefText(card({ remaining: "commit" }), " did it ", files, "+x");
    expect(text).toMatch(/^<system-reminder>\nThis card's prompt cache had gone cold.*\(83\.0k tokens\)/);
    expect(text).toContain("did it\n\nStill open, from its last status line: commit");
    expect(text).toContain("- a.ts (+2/-1)\n- b.ts\n\n```diff\n+x\n```\n</system-reminder>\n\n");
  });

  it("leaves out what it doesn't have", () => {
    const text = briefText(card({ remaining: "none", stats: undefined }), "s", [], "");
    expect(text).not.toMatch(/tokens\)|Still open|Files it changed|```/);
  });
});

describe("prebakeBrief and briefFor", () => {
  it("bakes once per cache and uses it for the next brief, then drops it", async () => {
    h.getCard.mockReturnValue(card());
    h.complete.mockResolvedValue("baked summary");
    await prebakeBrief("c1");
    await prebakeBrief("c1");
    expect(h.complete).toHaveBeenCalledTimes(1);
    expect(bakedSummary("c1")).toBe("baked summary");
    h.getThread.mockReturnValue([edit]);
    h.scopedDiff.mockReturnValue("+diff");
    const brief = await briefFor(card());
    expect(brief).toContain("baked summary");
    expect(brief).toContain("- a.ts (+2/-1)");
    expect(h.scopedDiff).toHaveBeenCalledWith("/p", [expect.objectContaining({ file: "a.ts" })]);
    expect(bakedSummary("c1")).toBeUndefined();
  });

  it("writes a new summary when the baked one is for an older cache, or falls back to the last line", async () => {
    h.getCard.mockReturnValue(card());
    h.complete.mockResolvedValueOnce("old");
    await prebakeBrief("c1");
    h.complete.mockResolvedValueOnce("new");
    expect(await briefFor(card({ stats: { cache: { ...cache, at: 200 } } }))).toContain("new");
    h.complete.mockRejectedValueOnce(new Error("down"));
    expect(await briefFor(card())).toContain("last words");
    h.complete.mockResolvedValueOnce("  ");
    expect(await briefFor(card({ lastLine: undefined }))).toContain("(no summary available");
  });

  it("does nothing for a missing card, one without a cache, or one already baking", async () => {
    h.getCard.mockReturnValue(undefined);
    await prebakeBrief("x");
    h.getCard.mockReturnValue(card({ stats: undefined }));
    await prebakeBrief("c1");
    expect(h.complete).not.toHaveBeenCalled();
    h.getCard.mockReturnValue(card({ id: "c2" }));
    let finish: (v: string) => void = () => {};
    h.complete.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const first = prebakeBrief("c2");
    await prebakeBrief("c2");
    finish("s");
    await first;
    expect(h.complete).toHaveBeenCalledTimes(1);
  });
});
