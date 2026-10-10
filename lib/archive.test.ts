import { describe, expect, it } from "vitest";
import { archivedMessage, neighborAfter } from "./archive";

describe("neighborAfter", () => {
  it("picks the card below the archived one", () => {
    expect(neighborAfter(["a", "b", "c"], ["b"])).toBe("c");
  });

  it("falls back to the card above at the bottom of the column", () => {
    expect(neighborAfter(["a", "b", "c"], ["c"])).toBe("b");
  });

  it("skips past every card that leaves", () => {
    expect(neighborAfter(["a", "b", "c", "d"], ["b", "c"])).toBe("d");
    expect(neighborAfter(["a", "b", "c", "d"], ["c", "d"])).toBe("b");
  });

  it("is undefined when the column empties or the card isn't in it", () => {
    expect(neighborAfter(["a"], ["a"])).toBeUndefined();
    expect(neighborAfter(["a", "b"], ["x"])).toBeUndefined();
  });
});

describe("archivedMessage", () => {
  it("names one card and counts several", () => {
    expect(archivedMessage(["Fix login"])).toBe("Archived “Fix login”.");
    expect(archivedMessage(["a", "b", "c"])).toBe("Archived 3 cards.");
  });
});
