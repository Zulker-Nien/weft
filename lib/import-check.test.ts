import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { brokenImports, exportsOf, importGuard, importReport, namedImports, projectRoot, resolveSpec } from "./import-check";

let root: string;

function write(files: Record<string, string>) {
  for (const [rel, src] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), src);
  }
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "import-check-")));
  write({ "package.json": "{}" });
  execFileSync("git", ["init", "-q"], { cwd: root });
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("exportsOf", () => {
  it("reads declared, default, listed and namespace exports", () => {
    const src = [
      "export function a() {}",
      "export async function b() {}",
      "export const c = 1;",
      "export class D {}",
      "export interface E {}",
      "export type F = 1;",
      "export enum G {}",
      "export default function H() {}",
      "export { i, j as k, type L };",
      "export * as ns from './x';",
    ].join("\n");
    expect([...(exportsOf(src) ?? [])].sort()).toEqual(["D", "E", "F", "G", "L", "a", "b", "c", "default", "i", "k", "ns"].sort());
  });

  it("can't know a module that re-exports everything, or one with no ESM exports", () => {
    expect(exportsOf("export * from './x';")).toBeNull();
    expect(exportsOf("module.exports = { a: 1 };")).toBeNull();
  });
});

describe("namedImports", () => {
  it("reads default, named, aliased and type imports, across lines, and re-exports", () => {
    const src = [
      'import React, { useState } from "react";',
      'import { a, b as c, type D } from "@/lib/x";',
      "import {",
      "  e, // the e",
      "  f,",
      '} from "./y";',
      'import Default from "./z";',
      'export { g } from "./w";',
      'import "./side.css";',
      'import * as all from "./ns";',
    ].join("\n");
    expect(namedImports(src)).toEqual([
      { spec: "react", names: ["default", "useState"], line: 1 },
      { spec: "@/lib/x", names: ["a", "b", "D"], line: 2 },
      { spec: "./y", names: ["e", "f"], line: 3 },
      { spec: "./z", names: ["default"], line: 7 },
      { spec: "./w", names: ["g"], line: 8 },
    ]);
  });
});

describe("resolveSpec and projectRoot", () => {
  it("finds local files by alias, path, extension and index, and leaves packages alone", () => {
    write({ "lib/a.ts": "", "lib/dir/index.tsx": "", "lib/b.css": "" });
    const from = path.join(root, "components/X.tsx");
    expect(resolveSpec(root, from, "@/lib/a")).toBe(path.join(root, "lib/a.ts"));
    expect(resolveSpec(root, from, "../lib/dir")).toBe(path.join(root, "lib/dir/index.tsx"));
    expect(resolveSpec(root, from, "@/lib/b.css")).toBe(path.join(root, "lib/b.css"));
    expect(resolveSpec(root, from, "@/lib/gone")).toBe("");
    expect(resolveSpec(root, from, "react")).toBeNull();
  });

  it("finds the folder with the project's config, or none", () => {
    write({ "lib/deep/a.ts": "" });
    expect(projectRoot(path.join(root, "lib/deep/a.ts"))).toBe(root);
    expect(projectRoot("/no-such-folder/a.ts")).toBeNull();
  });
});

describe("brokenImports", () => {
  it("reports a file that still imports an export another thread removed (the starMenu build error)", () => {
    write({
      "lib/card-menu.ts": "export function cardMenu() {}\n",
      "components/use-board-menus.ts": 'import { api } from "@/lib/client";\nimport { cardMenu, starMenu } from "@/lib/card-menu";\n',
      "components/Other.tsx": 'import { cardMenu } from "../lib/card-menu";\n',
    });
    expect(brokenImports(path.join(root, "lib/card-menu.ts"))).toEqual([
      "components/use-board-menus.ts:2 still imports `starMenu` from lib/card-menu.ts, which no longer exports it.",
    ]);
  });

  it("says them for several names, and finds an index module's importers by its folder", () => {
    write({ "lib/menu/index.ts": "export const keep = 1;\n", "a.ts": 'import Menu, { gone } from "./lib/menu";\n' });
    expect(brokenImports(path.join(root, "lib/menu/index.ts"))).toEqual([
      "a.ts:1 still imports its default export, `gone` from lib/menu/index.ts, which no longer exports them.",
    ]);
  });

  it("reports the edited file's own imports of missing names and missing modules", () => {
    write({
      "lib/x.ts": "export const a = 1;\nexport const b = 2;\n",
      "lib/old.cjs": "module.exports = {};\n",
      "lib/use.ts": ['import { a, nope } from "./x";', 'import { c, d } from "./x";', 'import { e } from "./gone";', 'import { f } from "./old.cjs";', 'import { useState } from "react";'].join("\n"),
    });
    expect(brokenImports(path.join(root, "lib/use.ts"))).toEqual([
      'lib/use.ts:1 imports `nope` from "./x", which doesn\'t export it.',
      'lib/use.ts:2 imports `c`, `d` from "./x", which doesn\'t export them.',
      'lib/use.ts:3 imports "./gone", which doesn\'t exist.',
    ]);
  });

  it("is quiet for healthy edits, files it doesn't check, and modules it can't read", () => {
    write({ "lib/x.ts": "export const a = 1;\n", "lib/y.ts": 'import { a } from "./x";\n', "notes.md": "", "lib/all.ts": "export * from './x';\n" });
    expect(brokenImports(path.join(root, "lib/x.ts"))).toEqual([]);
    expect(brokenImports(path.join(root, "notes.md"))).toEqual([]);
    expect(brokenImports(path.join(root, "lib/missing.ts"))).toEqual([]);
    expect(brokenImports(path.join(root, "lib/all.ts"))).toEqual([]);
  });

  it("skips files outside any project, and importers outside a git repo", () => {
    const loose = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "import-loose-")));
    try {
      fs.writeFileSync(path.join(loose, "a.ts"), 'import { x } from "./b";\n');
      expect(projectRoot(path.join(loose, "a.ts"))).toBeNull();
      expect(brokenImports(path.join(loose, "a.ts"))).toEqual([]);
    } finally {
      fs.rmSync(loose, { recursive: true, force: true });
    }
    fs.rmSync(path.join(root, ".git"), { recursive: true, force: true });
    write({ "lib/x.ts": "export const a = 1;\n", "lib/y.ts": 'import { gone } from "./x";\n' });
    expect(brokenImports(path.join(root, "lib/x.ts"))).toEqual([]);
  });
});

describe("importReport and importGuard", () => {
  const post = (tool_input: unknown) =>
    ({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input, tool_response: {}, tool_use_id: "t", session_id: "s", transcript_path: "", cwd: root }) as unknown as HookInput;
  const run = (input: HookInput) => importGuard(input, undefined, { signal: new AbortController().signal });

  it("lists each problem and how to fix it", () => {
    const report = importReport(["a.ts:1 still imports `x`."]);
    expect(report).toContain("- a.ts:1 still imports `x`.");
    expect(report).toContain("Parallel Change");
  });

  it("blocks with the report after an edit that breaks an import, relative to the session's folder", async () => {
    write({ "lib/x.ts": "export const a = 1;\n", "lib/y.ts": 'import { gone } from "./x";\n' });
    const out = await run(post({ file_path: "lib/x.ts" }));
    expect(out).toMatchObject({ decision: "block" });
    expect((out as { reason: string }).reason).toContain("lib/y.ts:1 still imports `gone`");
  });

  it("blocks after an edit that drops an import the file still uses", async () => {
    const after = 'import { b } from "./x";\n';
    write({ "lib/x.ts": "export const a = 1;\nexport const b = 2;\n", "lib/y.ts": `${after}a(b);\n` });
    const out = await run(post({ file_path: "lib/y.ts", old_string: 'import { a, b } from "./x";\n', new_string: after }));
    expect(out).toMatchObject({ decision: "block" });
    expect((out as { reason: string }).reason).toContain("y.ts no longer imports `a` but still uses it");
  });

  it("stays out of the way otherwise", async () => {
    write({ "lib/x.ts": "export const a = 1;\n" });
    expect(await run(post({ file_path: path.join(root, "lib/x.ts") }))).toEqual({});
    expect(await run(post(null))).toEqual({});
    expect(await run({ ...post({}), hook_event_name: "PreToolUse" } as HookInput)).toEqual({});
  });
});
