import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { droppedImports, importBindings, sourceBefore, stillUsed } from "./dropped-imports";

let root: string;
const file = () => path.join(root, "Board.tsx");
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dropped-imports-")));
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("importBindings", () => {
  it("names default, namespace, named, aliased and type imports, across lines", () => {
    const src = [
      'import React, { useState, type FC } from "react";',
      'import * as fs from "node:fs";',
      'import { a as b,\n  // why\n  c } from "./x";',
      'import type { T } from "./t";',
      'import "./side-effect.css";',
    ].join("\n");
    expect([...importBindings(src)].sort()).toEqual(["FC", "React", "T", "b", "c", "fs", "useState"]);
  });
});

describe("stillUsed", () => {
  it("sees calls, JSX tags and type uses", () => {
    expect(stillUsed("const w = columnMinWidth(state);", "columnMinWidth")).toBe(true);
    expect(stillUsed("return <ColumnHeader column={c} />;", "ColumnHeader")).toBe(true);
    expect(stillUsed("let x: LaneState;", "LaneState")).toBe(true);
  });

  it("ignores properties, object keys, comments, strings, imports and its own declarations", () => {
    expect(stillUsed("x.columnMinWidth(1)", "columnMinWidth")).toBe(false);
    expect(stillUsed("({ columnMinWidth: 1 })", "columnMinWidth")).toBe(false);
    expect(stillUsed("// columnMinWidth()\n/* columnMinWidth() */", "columnMinWidth")).toBe(false);
    expect(stillUsed('const s = "columnMinWidth()" + \'columnMinWidth\';', "columnMinWidth")).toBe(false);
    expect(stillUsed('import { columnMinWidth } from "./x";', "columnMinWidth")).toBe(false);
    expect(stillUsed("function columnMinWidth() {}\ncolumnMinWidth();", "columnMinWidth")).toBe(false);
  });
});

describe("sourceBefore", () => {
  it("undoes an Edit, a replace_all Edit and a MultiEdit on the text", () => {
    expect(sourceBefore("Edit", { old_string: "a, b", new_string: "a" }, "import { a } x", "f.ts")).toBe("import { a, b } x");
    expect(sourceBefore("Edit", { old_string: "x", new_string: "y", replace_all: true }, "y y", "f.ts")).toBe("x x");
    expect(sourceBefore("Edit", { old_string: "$&", new_string: "y" }, "y", "f.ts")).toBe("$&");
    const edits = [
      { old_string: "one", new_string: "two" },
      { old_string: "two", new_string: "three" },
    ];
    expect(sourceBefore("MultiEdit", { edits }, "three", "f.ts")).toBe("one");
  });

  it("can't tell after a deletion, a missing new_string or odd input", () => {
    expect(sourceBefore("Edit", { old_string: "x", new_string: "" }, "y", "f.ts")).toBeNull();
    expect(sourceBefore("Edit", { old_string: "x", new_string: "gone" }, "y", "f.ts")).toBeNull();
    expect(sourceBefore("Edit", { old_string: 1, new_string: "y" }, "y", "f.ts")).toBeNull();
    expect(sourceBefore("MultiEdit", { edits: "nope" }, "y", "f.ts")).toBeNull();
  });

  it("compares a Write with the last commit, and has nothing for a new or untracked file", () => {
    fs.writeFileSync(file(), "v1");
    expect(sourceBefore("Write", {}, "v2", file())).toBeNull();
    git("init", "-q");
    expect(sourceBefore("Write", {}, "v2", file())).toBeNull();
    git("add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "v1");
    expect(sourceBefore("Write", {}, "v2", file())).toBe("v1");
  });
});

describe("droppedImports", () => {
  const before = 'import { columnMinWidth, laneState } from "@/lib/lane";\nimport ColumnHeader from "./ColumnHeader";\n';
  const body = "const w = columnMinWidth(laneState);\nconst h = <ColumnHeader />;\n";

  it("names each import an Edit dropped that the file still uses", () => {
    const after = 'import { laneState } from "@/lib/lane";\n';
    fs.writeFileSync(file(), after + body);
    const input = { file_path: file(), old_string: before, new_string: after };
    const problems = droppedImports("Edit", input, file());
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("Board.tsx no longer imports `columnMinWidth` but still uses it");
    expect(problems[1]).toContain("`ColumnHeader`");
  });

  it("is quiet when the use went with the import, or the name moved to another import", () => {
    const after = 'import { laneState, columnMinWidth } from "@/lib/lane-width";\n';
    fs.writeFileSync(file(), `${after}const w = columnMinWidth(laneState);\n`);
    expect(droppedImports("Edit", { old_string: before, new_string: after }, file())).toEqual([]);
  });

  it("skips non-source files, missing files, odd input and edits it can't undo", () => {
    expect(droppedImports("Edit", { old_string: "a", new_string: "b" }, path.join(root, "notes.md"))).toEqual([]);
    expect(droppedImports("Edit", { old_string: "a", new_string: "b" }, path.join(root, "gone.ts"))).toEqual([]);
    expect(droppedImports("Edit", null, file())).toEqual([]);
    fs.writeFileSync(file(), body);
    expect(droppedImports("Edit", { old_string: before, new_string: "" }, file())).toEqual([]);
  });
});
