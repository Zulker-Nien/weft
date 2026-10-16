import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/react";
import { LOOKS_LIKE_MARKDOWN, slashAtCursor } from "./composer-slash";

describe("LOOKS_LIKE_MARKDOWN", () => {
  it("matches headings", () => {
    expect(LOOKS_LIKE_MARKDOWN.test("# Heading")).toBe(true);
    expect(LOOKS_LIKE_MARKDOWN.test("## Subhead")).toBe(true);
  });

  it("matches lists and blockquotes", () => {
    expect(LOOKS_LIKE_MARKDOWN.test("- one")).toBe(true);
    expect(LOOKS_LIKE_MARKDOWN.test("1. one")).toBe(true);
    expect(LOOKS_LIKE_MARKDOWN.test("> quote")).toBe(true);
    expect(LOOKS_LIKE_MARKDOWN.test("```code```")).toBe(true);
  });

  it("matches bold and links", () => {
    expect(LOOKS_LIKE_MARKDOWN.test("**bold**")).toBe(true);
    expect(LOOKS_LIKE_MARKDOWN.test("[label](https://x)")).toBe(true);
  });

  it("does not match plain prose", () => {
    expect(LOOKS_LIKE_MARKDOWN.test("Just a sentence.")).toBe(false);
    expect(LOOKS_LIKE_MARKDOWN.test("Hello world")).toBe(false);
  });
});

function fakeEditor(text: string, over: { empty?: boolean; code?: boolean; doc?: string; pos?: number } = {}) {
  return {
    state: {
      selection: { empty: over.empty ?? true, $from: { pos: over.pos ?? 1 + text.length, parentOffset: text.length, parent: { textBetween: () => text } } },
      doc: { textContent: over.doc ?? text },
    },
    isActive: () => over.code ?? false,
  } as unknown as Editor;
}

describe("slashAtCursor", () => {
  it("finds a /name right before the cursor", () => {
    expect(slashAtCursor(fakeEditor("/dep"))).toEqual({ query: "dep", from: 1, to: 5 });
    expect(slashAtCursor(fakeEditor("run /weft:done"))).toEqual({ query: "weft:done", from: 5, to: 15 });
    expect(slashAtCursor(fakeEditor("/"))).toEqual({ query: "", from: 1, to: 2 });
  });

  it("finds nothing mid-word, with a selection, in a code block, or in a ! command", () => {
    expect(slashAtCursor(fakeEditor("a/b"))).toBeNull();
    expect(slashAtCursor(fakeEditor("/dep", { empty: false }))).toBeNull();
    expect(slashAtCursor(fakeEditor("/dep", { code: true }))).toBeNull();
    expect(slashAtCursor(fakeEditor("/dep", { doc: " !ls /dep" }))).toBeNull();
    expect(slashAtCursor(fakeEditor("plain"))).toBeNull();
  });
});
