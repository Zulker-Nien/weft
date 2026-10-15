import { describe, expect, it } from "vitest";
import { columnMinWidth, laneDigest, lastAsked, lastReply } from "./copilot-lane";
import type { Card, ThreadItem } from "./types";

function card(over: Partial<Card>): Card {
  return {
    id: "c1",
    title: "A thread",
    prompt: "",
    cwd: "/dev/app",
    backend: "claude",
    permissionMode: "auto",
    column: "running",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe("columnMinWidth", () => {
  it("lets columns narrow further when the lane is open", () => {
    expect(columnMinWidth(true)).toBeLessThan(columnMinWidth(false));
  });
});

describe("lastAsked", () => {
  it("is the time of your last message, or 0 before you sent one", () => {
    expect(lastAsked([])).toBe(0);
    const items: ThreadItem[] = [
      { kind: "user", text: "hi", at: 10 },
      { kind: "assistant", text: "hello", at: 11 },
      { kind: "user", text: "and?", at: 20 },
      { kind: "assistant", text: "more", at: 21 },
    ];
    expect(lastAsked(items)).toBe(20);
  });
});

describe("lastReply", () => {
  it("is null before the copilot said anything", () => {
    expect(lastReply([{ kind: "user", text: "hi", at: 1 }])).toBeNull();
    expect(lastReply([{ kind: "assistant", text: "  ", at: 1 }])).toBeNull();
  });

  it("flattens the latest reply to one plain line without the status line", () => {
    const items: ThreadItem[] = [
      { kind: "assistant", text: "old", at: 1 },
      {
        kind: "assistant",
        text: "**Two** cards finished.\n\nSee [the card](weft://card/1) and `code`.\n```\nx\n```\nBOARD STATUS: column=done",
        at: 2,
      },
    ];
    expect(lastReply(items)).toBe("Two cards finished. See the card and code. x");
  });

  it("drops a session status line", () => {
    const items: ThreadItem[] = [{ kind: "assistant", text: "All clear.\n\n`=-=[ SESSION STATUS: Done ]=-= 23:19`", at: 1 }];
    expect(lastReply(items)).toBe("All clear.");
  });

  it("skips a reply that was only a status line", () => {
    const items: ThreadItem[] = [
      { kind: "assistant", text: "Real answer", at: 1 },
      { kind: "assistant", text: "BOARD STATUS: column=done", at: 2 },
    ];
    expect(lastReply(items)).toBe("Real answer");
  });

  it("cuts a long reply with an ellipsis", () => {
    const reply = lastReply([{ kind: "assistant", text: "word ".repeat(100), at: 1 }], 20);
    expect(reply).toHaveLength(20);
    expect(reply?.endsWith("…")).toBe(true);
  });
});

describe("laneDigest", () => {
  it("lists what needs you, newest first, leaving out archived cards and the copilot", () => {
    const cards = [
      card({ id: "a", column: "needs_you", updatedAt: 1 }),
      card({ id: "b", column: "needs_you", updatedAt: 5 }),
      card({ id: "c", column: "needs_you", archived: true }),
      card({ id: "copilot", column: "needs_you", role: "copilot" }),
      card({ id: "d", column: "running" }),
    ];
    expect(laneDigest(cards, []).needsYou.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("counts cards that reached Review or Done since you last asked", () => {
    const cards = [
      card({ id: "a", column: "review", updatedAt: 30 }),
      card({ id: "b", column: "done", updatedAt: 40 }),
      card({ id: "c", column: "done", updatedAt: 5 }),
      card({ id: "d", column: "running", updatedAt: 50 }),
    ];
    const items: ThreadItem[] = [{ kind: "user", text: "status?", at: 10 }];
    expect(laneDigest(cards, items)).toEqual({ needsYou: [], finished: 2, lastReply: null });
  });
});
