import { describe, expect, it } from "vitest";
import { MAX_TAG, MAX_TAGS, normalizeTag, normalizeTags, tagCounts, tagHue } from "./tags";

describe("normalizeTag", () => {
  it("lowercases, drops a leading #, and folds whitespace and commas to single spaces", () => {
    expect(normalizeTag("  Bug  Fix ")).toBe("bug fix");
    expect(normalizeTag("#UI")).toBe("ui");
    expect(normalizeTag("a,b\tc\nd")).toBe("a b c d");
  });

  it("is undefined when nothing is left", () => {
    expect(normalizeTag("")).toBeUndefined();
    expect(normalizeTag(" # ")).toBeUndefined();
  });

  it("caps a tag at GitHub's 50 characters, without a trailing space", () => {
    expect(normalizeTag("x".repeat(80))).toHaveLength(MAX_TAG);
    expect(normalizeTag(`${"x".repeat(49)} y`)).toBe("x".repeat(49));
  });
});

describe("normalizeTags", () => {
  it("normalizes, drops blanks and duplicates, keeps order and caps the count", () => {
    expect(normalizeTags(["Bug", "#bug", " ", "ui"])).toEqual(["bug", "ui"]);
    const many = normalizeTags(Array.from({ length: 12 }, (_, i) => `t${i}`));
    expect(many).toHaveLength(MAX_TAGS);
    expect(many[0]).toBe("t0");
  });
});

describe("tagCounts", () => {
  it("counts each tag across cards, most used first, then by name", () => {
    expect(tagCounts([{ tags: ["b", "a"] }, { tags: ["a", "c"] }, {}, { tags: ["b"] }])).toEqual([
      { tag: "a", count: 2 },
      { tag: "b", count: 2 },
      { tag: "c", count: 1 },
    ]);
    expect(tagCounts([])).toEqual([]);
  });
});

describe("tagHue", () => {
  it("is a steady hue in 0-359 per tag", () => {
    expect(tagHue("bug")).toBe(tagHue("bug"));
    expect(tagHue("bug")).not.toBe(tagHue("ui"));
    for (const tag of ["", "a", "a much longer tag 🚀"]) {
      expect(tagHue(tag)).toBeGreaterThanOrEqual(0);
      expect(tagHue(tag)).toBeLessThan(360);
    }
  });
});
