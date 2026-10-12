import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { measureQuality } from "./quality";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-quality-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
function project(files: Record<string, string>): string {
  const root = path.join(tmp, `p${n++}`);
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

const lines = (count: number, first = "") => [first, ...Array.from({ length: count }, (_, i) => `export const a${i} = ${i};`)].join("\n");
const docs = (root: string) => measureQuality(root).sections.find((s) => s.key === "docs");
const failing = (root: string) => docs(root)?.checks.filter((c) => !c.ok).map((c) => c.label) ?? [];

describe("documentation section", () => {
  it("scores 0 with no docs and unexplained files", () => {
    const root = project({ "src/a.ts": lines(50) });
    expect(docs(root)).toMatchObject({ name: "Documentation", score: 0, summary: "no docs; 0% of files explained" });
  });

  it("scores 100 for a fully documented project", () => {
    const root = project({
      "README.md": "See `src/a.ts` and `docs/architecture/`.",
      "CLAUDE.md": "@AGENTS.md",
      "CHANGELOG.md": "Removed `src/gone.ts`.",
      "docs/architecture/one.md": "Lives in `src/a.ts:12`.",
      "src/a.ts": lines(50, "// What this file is for."),
      "src/tiny.ts": lines(5),
      "src/a.test.ts": lines(50),
    });
    expect(docs(root)).toMatchObject({
      score: 100,
      summary: "README, agent guide, 1 architecture doc; 100% of files explained",
    });
  });

  it("counts a comment after the imports, Python comments and docstrings, but not a shebang", () => {
    const root = project({
      "README.md": "",
      "a.ts": `import x from "x";\n\n/** Explains. */\n${lines(50)}`,
      "b.py": `"""Explains."""\n${lines(50)}`,
      "c.py": `#!/usr/bin/env python\n${lines(50)}`,
      "d.py": `# Explains.\n${lines(50)}`,
    });
    expect(docs(root)?.summary).toBe("README; 75% of files explained");
    expect(failing(root)).toContain("80%+ of source files over 40 lines open with a comment saying what they're for");
  });

  it("names file paths the docs mention that are gone, under folders the repo has", () => {
    const root = project({
      "README.md": "`src/a.ts` `src/gone.ts` `src/old/` `Weft.app/Contents/x.js` `node_modules/x/y.js` `src/*.ts` `a/b`",
      "AGENTS.md": "`src/gone.ts`",
      "docs/architecture/x.md": "`docs/missing.md`",
      "docs/architecture/y.md": "",
      "src/a.ts": "",
    });
    const section = docs(root);
    expect(section?.summary).toBe("README, agent guide, 2 architecture docs; 100% of files explained, 3 stale paths");
    expect(failing(root)).toEqual([
      "a CHANGELOG",
      "every file path the docs name exists (missing: docs/missing.md, src/gone.ts, src/old/)",
    ]);
  });

  it("says stale path, singular, and fails the path check with no guides at all", () => {
    expect(docs(project({ "README.md": "`src/gone.ts`", "src/a.ts": "" }))?.summary).toContain(", 1 stale path");
    expect(failing(project({ "src/a.ts": "" }))).toContain("every file path the docs name exists");
  });

  it("reads the file list from git when the folder is a repo", () => {
    const root = project({ "README.md": "`src/gone.ts`", "src/a.ts": lines(50, "// Explains."), "ignored/b.ts": lines(50) });
    fs.writeFileSync(path.join(root, ".gitignore"), "ignored/\n");
    execFileSync("git", ["init", "-q"], { cwd: root });
    expect(docs(root)?.summary).toBe("README; 100% of files explained, 1 stale path");
  });
});

const section = (root: string, key: string) => measureQuality(root).sections.find((s) => s.key === key);

describe("measureQuality", () => {
  it("averages the documentation section in with the others", () => {
    const report = measureQuality(project({ "src/a.ts": lines(50) }));
    expect(report.sections.map((s) => s.key)).toEqual(["tests", "size", "lint", "types", "guards", "docs"]);
  });

  it("reads line and branch coverage from the coverage report", () => {
    const total = { lines: { pct: 91.4 }, branches: { pct: 80.6 } };
    const root = project({ "coverage/coverage-summary.json": JSON.stringify({ total }) });
    expect(measureQuality(root).coverageAt).toEqual(expect.any(Number));
    expect(section(root, "tests")).toMatchObject({ score: 91, summary: "91% of lines covered, 81% of branches" });
  });

  it("scores a strict Python project", () => {
    const root = project({ "mypy.ini": "[mypy]\nstrict = true", "a.py": "x = 1\n" });
    expect(section(root, "types")?.checks.every((c) => c.ok)).toBe(true);
  });

  it("follows a hook and CI into the scripts and package scripts they call", () => {
    const root = project({
      "package.json": JSON.stringify({ scripts: { check: "tsc --noEmit && vitest run" } }),
      ".githooks/pre-commit": "sh scripts/hook.sh && npm run check",
      "scripts/hook.sh": "eslint .",
      ".github/workflows/ci.yml": "run: npm run check && npx eslint .",
    });
    expect(section(root, "guards")?.checks.filter((c) => !c.ok)).toEqual([]);
  });

  it("reads a broken package.json as none", () => {
    expect(() => measureQuality(project({ "package.json": "{" }))).not.toThrow();
  });

  it("skips files git lists but the tree no longer has", () => {
    const root = project({ "a.ts": lines(400), "b.ts": lines(10) });
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    fs.rmSync(path.join(root, "a.ts"));
    expect(section(root, "size")?.longFiles ?? []).toEqual([]);
  });
});
