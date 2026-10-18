import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isFiltered } from "./run-tests.mjs";

describe("isFiltered", () => {
  it("is false for the whole suite, with or without flags", () => {
    expect(isFiltered([])).toBe(false);
    expect(isFiltered(["--coverage"])).toBe(false);
    expect(isFiltered(["run", "--reporter", "dot", "-t", "some name"])).toBe(false);
  });

  it("is true when a file or folder is named", () => {
    expect(isFiltered(["lib/x.test.ts"])).toBe(true);
    expect(isFiltered(["--coverage", "--coverage.include=lib/x.ts", "lib/x.test.ts"])).toBe(true);
    expect(isFiltered(["-t", "name", "lib"])).toBe(true);
  });
});

describe("the command line", () => {
  const script = path.join(__dirname, "run-tests.mjs");

  it("passes vitest's exit code through, for a filtered run and a whole-suite run", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-tests-"));
    const run = (args: string[]) => {
      try {
        // Its own lock folder, so the whole-suite run doesn't wait behind another card's.
        execFileSync(process.execPath, [script, ...args], { cwd: dir, stdio: "pipe", env: { ...process.env, WEFT_LOCK_DIR: dir } });
        return 0;
      } catch (err) {
        return (err as { status: number }).status;
      }
    };
    fs.writeFileSync(path.join(dir, "vitest.config.mjs"), "export default { test: { globals: true } };\n");
    fs.writeFileSync(path.join(dir, "ok.test.mjs"), 'test("ok", () => {});\n');
    const cfg = ["--root", dir, "--config", path.join(dir, "vitest.config.mjs")];
    expect(run([...cfg, "ok.test.mjs"])).toBe(0);
    fs.writeFileSync(path.join(dir, "bad.test.mjs"), 'test("bad", () => { throw new Error("x"); });\n');
    expect(run(cfg)).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 60_000);
});
