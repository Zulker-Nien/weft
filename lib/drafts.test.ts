// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { moveDraft, readDraft, replyDraftKey, writeDraft } from "./drafts";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("drafts", () => {
  it("round-trips text and reads empty when nothing is saved", () => {
    expect(readDraft("k")).toBe("");
    writeDraft("k", "half a thought");
    expect(readDraft("k")).toBe("half a thought");
  });

  it("removes the draft when the text is blank", () => {
    writeDraft("k", "x");
    writeDraft("k", "  \n");
    expect(localStorage.getItem("k")).toBeNull();
  });

  it("swallows storage errors", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(readDraft("k")).toBe("");
    expect(() => writeDraft("k", "x")).not.toThrow();
  });

  it("moves a draft onto another, after what is already there", () => {
    expect(replyDraftKey("c1")).toBe("weft.reply.c1");
    writeDraft("from", "the rest");
    expect(moveDraft("from", "to")).toBe("the rest");
    expect(readDraft("from")).toBe("");
    writeDraft("from", "more");
    expect(moveDraft("from", "to")).toBe("the rest\n\nmore");
    expect(readDraft("to")).toBe("the rest\n\nmore");
  });

  it("moves nothing when the source is blank", () => {
    writeDraft("to", "kept");
    expect(moveDraft("from", "to")).toBe("");
    expect(readDraft("to")).toBe("kept");
  });
});
