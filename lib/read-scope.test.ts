import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { suggestReadScope, withReadScope } from "./read-scope";

// A scratch project we point cwd at, with a sibling project for "outside the project" suggestions.
// `outside` lives under a directory we treat as `$HOME` so the agent's `~/...` paths resolve to it.
let home: string;
let project: string;
let outside: string;
let outsideFile: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-read-scope-home-"));
  project = fs.mkdtempSync(path.join(home, "weft-"));
  outside = fs.mkdtempSync(path.join(home, "deckcp-"));
  outsideFile = path.join(outside, "src", "app", "login", "page.tsx");
  fs.mkdirSync(path.dirname(outsideFile), { recursive: true });
  fs.writeFileSync(outsideFile, "// login page");
  // A package.json in the outside project so projectRoot has a marker to stop at.
  fs.writeFileSync(path.join(outside, "package.json"), "{}");
  process.env.HOME = home;
});

afterEach(() => {
  // Some macOS /tmp sandboxes make it painful to remove the parent; use maxRetries.
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 3 });
});

describe("suggestReadScope", () => {
  it("returns the parent directory when the question names a file outside cwd", () => {
    const token = `~/${path.basename(outside)}/src/app/login/page.tsx`;
    const result = suggestReadScope(`could you paste ${token}?`, project);
    expect(result).toBeDefined();
    expect(result?.directory).toBe(outside);
    expect(result?.token).toBe(token);
  });

  it("returns the directory itself when the question names it directly", () => {
    const token = `~/${path.basename(outside)}`;
    const result = suggestReadScope(`read the deck at ${token}`, project);
    expect(result?.directory).toBe(outside);
    expect(result?.token).toBe(token);
  });

  it("falls back to one level up when the file's project has no marker", () => {
    fs.unlinkSync(path.join(outside, "package.json"));
    const token = `~/${path.basename(outside)}/src/app/login/page.tsx`;
    const result = suggestReadScope(`paste ${token}`, project);
    expect(result?.directory).toBe(path.dirname(outsideFile));
  });

  it("strips trailing shell punctuation", () => {
    const token = `~/${path.basename(outside)}/src/app/login/page.tsx`;
    const result = suggestReadScope(`paste ${token}, please.`, project);
    expect(result?.directory).toBe(outside);
  });

  it("returns undefined when every path is inside cwd", () => {
    fs.writeFileSync(path.join(project, "inside.txt"), "");
    const result = suggestReadScope(`paste ${path.join(project, "inside.txt")}`, project);
    expect(result).toBeUndefined();
  });

  it("returns undefined when no path-like token is present", () => {
    expect(suggestReadScope("Could you paste the file?", project)).toBeUndefined();
  });

  it("ignores paths that don't exist on disk", () => {
    const ghost = path.join(path.dirname(outside), "ghost-xyz", "page.tsx");
    const result = suggestReadScope(`read ${ghost}`, project);
    expect(result).toBeUndefined();
  });

  it("returns undefined for an empty question", () => {
    expect(suggestReadScope("", project)).toBeUndefined();
  });

  it("prefers the shorter token when several reference the same directory", () => {
    const dir = `~/${path.basename(outside)}`;
    const file = `${dir}/src/app/login/page.tsx`;
    const result = suggestReadScope(`paste ${file} (it's under ${dir})`, project);
    expect(result?.token).toBe(dir);
    expect(result?.directory).toBe(outside);
  });
});

describe("withReadScope", () => {
  it("adds a new directory to the scope", () => {
    expect(withReadScope(undefined, outside, project)).toEqual([outside]);
  });

  it("dedupes when the directory is already in the scope", () => {
    expect(withReadScope([outside], outside, project)).toEqual([outside]);
  });

  it("drops entries that are inside cwd", () => {
    const inside = path.join(project, "packages", "ui");
    fs.mkdirSync(inside, { recursive: true });
    expect(withReadScope([inside, outside], outside, project)).toEqual([outside]);
  });

  it("keeps multiple distinct outside directories", () => {
    const other = fs.mkdtempSync(path.join(home, "other-"));
    try {
      const result = withReadScope([outside], other, project);
      expect(result.sort()).toEqual([outside, other].sort());
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});
