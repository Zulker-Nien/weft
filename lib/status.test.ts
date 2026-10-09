import { describe, expect, it } from "vitest";
import { extractStatus } from "./status";

describe("extractStatus", () => {
  it("reads a valid line and strips it from the text", () => {
    const { text, status } = extractStatus(
      "All done.\n\nBOARD STATUS: column=review | stage=First shot | remaining=add a test, commit",
    );
    expect(status).toEqual({ column: "review", stage: "First shot", remaining: "add a test, commit" });
    expect(text).toBe("All done.");
  });

  it("returns no status and the text untouched when there is no line", () => {
    expect(extractStatus("Just a reply.\n")).toEqual({ text: "Just a reply.", status: undefined });
  });

  it("tolerates extra whitespace, case and markdown wrapping", () => {
    const line = "  > **BOARD STATUS:   column = Needs-You |  stage = Planning  |remaining=  a decision  **";
    const { status } = extractStatus(`hi\n${line}`);
    expect(status).toEqual({ column: "needs_you", stage: "Planning", remaining: "a decision" });
    expect(extractStatus("`board status: column=done | stage=Done | remaining=none`").status).toEqual({
      column: "done",
      stage: "Done",
      remaining: undefined,
    });
  });

  it("treats remaining=none as nothing left", () => {
    expect(extractStatus("BOARD STATUS: column=done | stage=Done | remaining=None.").status?.remaining).toBeUndefined();
  });

  it("accepts a line with only a column", () => {
    expect(extractStatus("BOARD STATUS: column=review").status).toEqual({
      column: "review",
      stage: undefined,
      remaining: undefined,
    });
  });

  it("ignores an unknown or missing column but still strips the line", () => {
    for (const line of ["BOARD STATUS: column=running | stage=X", "BOARD STATUS: stage=Planning", "BOARD STATUS: nonsense"]) {
      const result = extractStatus(`text\n${line}`);
      expect(result.status).toBeUndefined();
      expect(result.text).toBe("text");
    }
  });

  it("keeps an unknown stage as written", () => {
    expect(extractStatus("BOARD STATUS: column=review | stage=Whatever").status?.stage).toBe("Whatever");
  });

  it("uses the last valid line when there are several", () => {
    const { text, status } = extractStatus(
      "a\nBOARD STATUS: column=needs_you | stage=Planning\nb\nBOARD STATUS: column=done | stage=Done | remaining=none",
    );
    expect(status?.column).toBe("done");
    expect(text).toBe("a\nb");
  });

  it("keeps an earlier valid status when a later line is invalid", () => {
    const { status } = extractStatus("BOARD STATUS: column=review\nBOARD STATUS: column=bogus");
    expect(status?.column).toBe("review");
  });

  it("ignores a mid-sentence mention", () => {
    const text = "I end replies with a BOARD STATUS: column=review line.";
    expect(extractStatus(text)).toEqual({ text, status: undefined });
  });

  // KNOWN BUG: the label alone in bold ("**BOARD STATUS:** column=...") leaves "**" glued to the first key,
  // so the line is stripped but no status is read. Remove `.fails` once lib/status.ts handles it.
  it.fails("reads a line where only the label is bold", () => {
    const { status } = extractStatus("hi\n**BOARD STATUS:** column=review | stage=Polishing | remaining=none");
    expect(status?.column).toBe("review");
  });

  // KNOWN BUG: extractStatus works line by line, so a status line quoted in a fenced code block is
  // deleted from the text and can move the card. Remove `.fails` once lib/status.ts skips fences.
  it.fails("does not act on a status line quoted inside a code block", () => {
    const reply = "Example:\n```\nBOARD STATUS: column=done | stage=Done | remaining=none\n```\nBOARD STATUS: column=review | stage=Polishing";
    const { text, status } = extractStatus(reply);
    expect(text).toContain("BOARD STATUS: column=done");
    expect(status?.column).toBe("review");
  });

  it("folds the blank lines the removed line leaves behind", () => {
    expect(extractStatus("a\n\nBOARD STATUS: column=review\n\nb").text).toBe("a\n\nb");
  });
});
