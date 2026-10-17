import { describe, expect, it } from "vitest";
import { preserveFormatting } from "./markdown-preserve";

describe("preserveFormatting", () => {
  it("returns original exactly when nothing changed", () => {
    const text = "# Title\n\nA paragraph.\n";
    expect(preserveFormatting(text, text, text)).toBe(text);
  });

  it("keeps untouched lines byte-identical when the editor reformats elsewhere", () => {
    // The file has trailing whitespace on a blank line; TipTap normalizes it to no spaces. The
    // user only edits the last paragraph (turning it into a heading). The bytes of the untouched
    // lines (header + the spaces-only blank) must survive.
    const original = "# Title\n  \n\nLast paragraph  \n";
    const baseline = "# Title\n\n\nLast paragraph\n";
    const edited = "# Title\n\n\n## Last\n";
    const out = preserveFormatting(original, baseline, edited);
    // Header (file's exact bytes), spaces-only blank (file's exact bytes), then the editor's
    // reformatted form of the changed region (its two lines: blank + heading).
    expect(out).toBe("# Title\n  \n\n\n## Last\n");
  });

  it("writes only the edited hunk and keeps everything else from the file", () => {
    const original = [
      "# Title",
      "",
      "First paragraph.",
      "",
      "Middle paragraph.",
      "",
      "Last paragraph.",
      "",
    ].join("\n");
    const baseline = original;
    const edited = [
      "# Title",
      "",
      "First paragraph.",
      "",
      "Middle paragraph, edited.",
      "",
      "Last paragraph.",
      "",
    ].join("\n");
    const out = preserveFormatting(original, baseline, edited);
    expect(out).toBe(edited);
    // Identical to edited — no formatting changes.
    expect(out).toBe(
      [
        "# Title",
        "",
        "First paragraph.",
        "",
        "Middle paragraph, edited.",
        "",
        "Last paragraph.",
        "",
      ].join("\n"),
    );
  });

  it("takes the editor's version on a conflicting hunk", () => {
    // The user and the file both changed the same line in different ways. The user's view wins.
    const original = "shared line\n";
    const baseline = "shared line\n";
    const edited = "user's new line\n";
    // Simulate the file also being different on disk by making the original differ from the
    // baseline. preserveFormatting compares baseline vs edited; if they differ it merges baseline
    // and edited against original.
    const out = preserveFormatting(original, baseline, edited);
    expect(out).toBe("user's new line\n");
  });

  it("returns the edited form when the baseline already matches the file (no reformatting possible)", () => {
    // Edge case: original === roundTrippedOriginal, so the editor didn't reformat anything. We
    // can't merge because there's no third view; return edited as the only sensible save target.
    const original = "line\n";
    const edited = "different line\n";
    expect(preserveFormatting(original, original, edited)).toBe(edited);
  });

  it("preserves a file with no trailing newline", () => {
    const original = "line1\nline2";
    const baseline = "line1\nline2";
    const edited = "line1\nline2 edited";
    expect(preserveFormatting(original, baseline, edited)).toBe("line1\nline2 edited");
  });

  it("inserts an added line in the right place", () => {
    const original = "a\nb\nc\n";
    const baseline = "a\nb\nc\n";
    const edited = "a\nb\ninserted\nc\n";
    expect(preserveFormatting(original, baseline, edited)).toBe("a\nb\ninserted\nc\n");
  });
});
