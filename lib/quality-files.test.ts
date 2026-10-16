import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { listFiles, listSources, projectRoot, read, readSources } from "./quality-files";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-quality-files-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function put(root: string, rel: string, text = "x\n") {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

describe("projectRoot", () => {
  it("is the nearest folder with .git, else the folder itself", () => {
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
    fs.mkdirSync(path.join(repo, "a/b"), { recursive: true });
    expect(projectRoot(path.join(repo, "a/b"))).toBe(repo);
    const loose = fs.mkdtempSync(path.join(tmp, "loose-"));
    // (the temp dir sits under no repo, so the walk reaches / and falls back)
    expect(projectRoot(loose)).toBe(loose);
  });
});

describe("listFiles", () => {
  it("walks a folder that isn't a git repo, skipping dependency and dot folders", () => {
    const root = fs.mkdtempSync(path.join(tmp, "walk-"));
    put(root, "src/a.ts");
    put(root, "README.md");
    put(root, "node_modules/x/y.ts");
    put(root, ".hidden/z.ts");
    expect(listFiles(root).sort()).toEqual(["README.md", "src/a.ts"]);
  });

  it("asks git for tracked and untracked files when it's a repo", () => {
    const root = fs.mkdtempSync(path.join(tmp, "git-"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    put(root, "a.ts");
    put(root, ".gitignore", "ignored.ts\n");
    put(root, "ignored.ts");
    expect(listFiles(root).sort()).toEqual([".gitignore", "a.ts"]);
  });
});

describe("listSources", () => {
  it("keeps source files and drops generated, minified and skipped-folder ones", () => {
    expect(listSources(["a.ts", "b.d.ts", "c.min.js", "d.md", "node_modules/e.ts", "src/.x/f.ts", "src/g.py"])).toEqual(["a.ts", "src/g.py"]);
  });
});

describe("readSources", () => {
  it("reads text, counts lines and marks tests", () => {
    const root = fs.mkdtempSync(path.join(tmp, "src-"));
    put(root, "a.ts", "one\ntwo\n");
    put(root, "empty.ts", "");
    put(root, "a.test.ts", "t");
    put(root, "big.ts", "x".repeat(1_000_001));
    const out = readSources(root, ["a.ts", "empty.ts", "a.test.ts", "big.ts", "gone.ts"]);
    expect(out.map((s) => [s.path, s.lines, s.test])).toEqual([
      ["a.ts", 2, false],
      ["empty.ts", 0, false],
      ["a.test.ts", 1, true],
    ]);
  });
});

describe("read", () => {
  it("returns a file's text, or an empty string when it's missing", () => {
    const root = fs.mkdtempSync(path.join(tmp, "read-"));
    put(root, "f.txt", "hello");
    expect(read(root, "f.txt")).toBe("hello");
    expect(read(root, "nope.txt")).toBe("");
  });
});
