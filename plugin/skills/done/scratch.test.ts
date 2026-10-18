import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// scratch.sh against a temp WEFT_DATA, run from a temp "repo" folder.
const SCRIPT = path.join(__dirname, "scratch.sh");
let tmp: string;
let data: string;
let repo: string;

function run(...args: string[]) {
  const r = spawnSync("bash", [SCRIPT, ...args], { cwd: repo, encoding: "utf8", env: { ...process.env, WEFT_DATA: data } });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-scratch-"));
  data = path.join(tmp, "data");
  repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("scratch.sh", () => {
  it("makes a run folder with out/ under the data dir, not in the repo", () => {
    const r = run("new");
    expect(r.code).toBe(0);
    expect(path.dirname(r.out)).toBe(path.join(data, "done"));
    expect(path.basename(r.out)).toMatch(/^run-/);
    expect(fs.statSync(path.join(r.out, "out")).isDirectory()).toBe(true);
    expect(fs.readdirSync(repo)).toEqual([]);
  });

  it("gives two runs at once their own folders", () => {
    const a = run("new").out;
    const b = run("new").out;
    expect(a).not.toBe(b);
  });

  it("prunes run folders older than a day, keeps fresh ones and anything else", () => {
    const old = run("new").out;
    const fresh = run("new").out;
    const other = path.join(data, "done", "keep-me");
    fs.mkdirSync(other);
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    fs.utimesSync(old, twoDaysAgo, twoDaysAgo);
    fs.utimesSync(other, twoDaysAgo, twoDaysAgo);
    run("new");
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(other)).toBe(true);
  });

  it("clean removes its own run folder and leaves the others", () => {
    const a = run("new").out;
    const b = run("new").out;
    fs.writeFileSync(path.join(a, "tasks.json"), "[]");
    expect(run("clean", a + "/").code).toBe(0);
    expect(fs.existsSync(a)).toBe(false);
    expect(fs.existsSync(b)).toBe(true);
  });

  it("clean refuses anything that isn't a run folder directly under done/", () => {
    const a = run("new").out;
    const outside = path.join(tmp, "run-elsewhere");
    fs.mkdirSync(outside);
    for (const bad of [outside, repo, path.join(data, "done"), path.join(a, "out"), path.join(data, "done", "run-x", ".."), ""]) {
      const r = run("clean", bad);
      expect(r.code).toBe(1);
      expect(r.err).toContain("Not a /weft:done run folder");
    }
    expect(fs.existsSync(outside)).toBe(true);
    expect(fs.existsSync(a)).toBe(true);
  });

  it("prints usage on an unknown command", () => {
    expect(run("nope").code).toBe(2);
  });
});
