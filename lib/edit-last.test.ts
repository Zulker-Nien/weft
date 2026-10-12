import { describe, expect, it } from "vitest";
import { foldFrom, lastSent, rewindPoint } from "./edit-last";
import type { ThreadItem } from "./types";

const user = (text: string, id?: string): ThreadItem => ({ kind: "user", text, at: 1, ...(id && { id }) });
const tool = (name: string, isError = false): ThreadItem => ({ kind: "tool", id: name, name, summary: "", at: 2, isError });

describe("lastSent", () => {
  it("finds your last message, its prompt id and the file edits its turn made", () => {
    const items = [user("one", "p1"), tool("Edit"), user("two", "p2"), tool("Edit"), tool("Write"), tool("Read"), tool("Edit", true), null];
    expect(lastSent(items)).toEqual({ index: 2, text: "two", promptId: "p2", fileEdits: 2 });
  });

  it("has no prompt id on an untagged message, and nothing when you haven't sent one", () => {
    expect(lastSent([user("one")])).toEqual({ index: 0, text: "one", promptId: undefined, fileEdits: 0 });
    expect(lastSent([{ kind: "assistant", text: "hi", at: 1 }])).toBeUndefined();
    expect(lastSent([])).toBeUndefined();
  });
});

describe("rewindPoint", () => {
  const transcript = [
    "not json p2",
    JSON.stringify({ uuid: "a1", parentUuid: null, note: "mentions p2" }),
    JSON.stringify({ uuid: "p1", parentUuid: null }),
    JSON.stringify({ uuid: "p2", parentUuid: "a1" }),
    JSON.stringify({ uuid: "p3" }),
  ].join("\n");

  it("returns the entry the prompt followed", () => {
    expect(rewindPoint(transcript, "p2")).toBe("a1");
  });

  it("returns null for a prompt that opened the session", () => {
    expect(rewindPoint(transcript, "p1")).toBeNull();
    expect(rewindPoint(transcript, "p3")).toBeNull();
  });

  it("returns undefined when the transcript doesn't hold it", () => {
    expect(rewindPoint(transcript, "nope")).toBeUndefined();
    expect(rewindPoint("", "p1")).toBeUndefined();
  });
});

describe("foldFrom", () => {
  it("folds the items from an index on into one edited item", () => {
    const items = [user("one"), user("two"), tool("Edit")];
    expect(foldFrom(items, 1, 9)).toEqual([user("one"), { kind: "edited", items: [user("two"), tool("Edit")], at: 9 }]);
  });
});
