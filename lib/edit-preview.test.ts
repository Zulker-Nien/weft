import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DIFF_CAP, editPreview, lineDiff } from "./edit-preview";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-edit-preview-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("lineDiff", () => {
  it("keeps common lines as context and marks the change", () => {
    expect(lineDiff("a\nb\nc\n", "a\nB\nc\n")).toEqual([
      { kind: " ", text: "a" },
      { kind: "-", text: "b" },
      { kind: "+", text: "B" },
      { kind: " ", text: "c" },
    ]);
  });

  it("finds lines kept in the middle of a change", () => {
    expect(lineDiff("x\nkeep\ny", "1\nkeep\n2\n3").map((l) => l.kind + l.text)).toEqual(["-x", "+1", " keep", "-y", "+2", "+3"]);
  });

  it("handles empty sides", () => {
    expect(lineDiff("", "new")).toEqual([{ kind: "+", text: "new" }]);
    expect(lineDiff("old", "")).toEqual([{ kind: "-", text: "old" }]);
    expect(lineDiff("", "")).toEqual([]);
  });

  it("falls back to all removed then all added past the LCS budget", () => {
    const a = Array.from({ length: 600 }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: 600 }, (_, i) => (i % 2 ? `a${i}` : `b${i}`)).join("\n");
    const out = lineDiff(a, b);
    // Only the shared last line stays as context; the 599 lines before it don't run through LCS.
    expect(out.filter((l) => l.kind === " ")).toEqual([{ kind: " ", text: "a599" }]);
    expect(out[0]).toEqual({ kind: "-", text: "a0" });
    expect(out[599]).toEqual({ kind: "+", text: "b0" });
  });
});

describe("editPreview", () => {
  it("reads an Edit as a change to a file in the card's folder", () => {
    const out = editPreview("Edit", { file_path: path.join(tmp, "lib/a.ts"), old_string: "one\ntwo", new_string: "one\n2\n3" }, tmp, ["setupGaps"]);
    expect(out).toEqual({
      file: path.join("lib", "a.ts"),
      symbols: ["setupGaps"],
      added: 2,
      removed: 1,
      lines: [
        { kind: " ", text: "one" },
        { kind: "-", text: "two" },
        { kind: "+", text: "2" },
        { kind: "+", text: "3" },
      ],
      more: 0,
      creates: undefined,
    });
  });

  it("joins a MultiEdit's edits and tolerates junk ones", () => {
    const out = editPreview("MultiEdit", { file_path: "a.ts", edits: [{ old_string: "a", new_string: "b" }, null, { old_string: "c" }] }, tmp, []);
    expect(out?.lines.map((l) => l.kind + l.text)).toEqual(["-a", "+b", "-c"]);
    expect(out?.symbols).toBeUndefined();
    expect(editPreview("MultiEdit", { file_path: "a.ts" }, tmp)?.lines).toEqual([]);
  });

  it("diffs a Write against the file on disk, or marks a new file", () => {
    const file = path.join(tmp, "w.txt");
    fs.writeFileSync(file, "keep\nold\n");
    expect(editPreview("Write", { file_path: file, content: "keep\nnew\n" }, tmp)).toMatchObject({ file: "w.txt", added: 1, removed: 1 });
    const fresh = editPreview("Write", { file_path: path.join(tmp, "nope.txt"), content: "hi" }, tmp);
    expect(fresh).toMatchObject({ creates: true, added: 1, removed: 0 });
    expect(editPreview("Write", { file_path: path.join(tmp, "x.txt"), content: 5 }, tmp)).toMatchObject({ added: 0, creates: true });
  });

  it("shows a NotebookEdit's new source and keeps a path outside the folder absolute", () => {
    expect(editPreview("NotebookEdit", { notebook_path: "/elsewhere/n.ipynb", new_source: "print(1)" }, tmp)).toMatchObject({
      file: "/elsewhere/n.ipynb",
      added: 1,
    });
  });

  it("caps the diff and counts what it left out", () => {
    const out = editPreview("Write", { file_path: path.join(tmp, "big.txt"), content: Array.from({ length: DIFF_CAP + 5 }, (_, i) => `${i}`).join("\n") }, tmp);
    expect(out?.lines).toHaveLength(DIFF_CAP);
    expect(out?.more).toBe(5);
    expect(out?.added).toBe(DIFF_CAP + 5);
  });

  it("is undefined for tools that don't edit a file", () => {
    expect(editPreview("Bash", { command: "ls" }, tmp)).toBeUndefined();
    expect(editPreview("Read", { file_path: "a.ts" }, tmp)).toBeUndefined();
    expect(editPreview("Edit", {}, tmp)).toBeUndefined();
  });
});
