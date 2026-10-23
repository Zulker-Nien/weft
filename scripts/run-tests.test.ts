import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCOPED_COVERAGE_DIR, isFiltered, scopedCoverageArgs, vitestArgs } from "./run-tests.mjs";

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

describe("vitestArgs", () => {
  it("takes out the script's own flags, which Vitest refuses as unknown options", () => {
    expect(vitestArgs(["--coverage", "--no-memory-gate", "--no-watchdog", "-t", "x"])).toEqual(["--coverage", "-t", "x"]);
  });
});

describe("scopedCoverageArgs", () => {
  it("sends a named-file coverage run's report to a temp folder, so the whole-repo report survives", () => {
    expect(scopedCoverageArgs(["lib/x.test.ts", "--coverage"])).toEqual([
      "lib/x.test.ts",
      "--coverage",
      `--coverage.reportsDirectory=${SCOPED_COVERAGE_DIR}`,
    ]);
    expect(scopedCoverageArgs(["--coverage.include=lib/x.ts", "lib/x.test.ts"])).toContain(`--coverage.reportsDirectory=${SCOPED_COVERAGE_DIR}`);
  });

  it("leaves a run without coverage, or with its own report folder, as it is", () => {
    expect(scopedCoverageArgs(["lib/x.test.ts"])).toEqual(["lib/x.test.ts"]);
    const own = ["lib/x.test.ts", "--coverage", "--coverage.reportsDirectory=/tmp/mine"];
    expect(scopedCoverageArgs(own)).toEqual(own);
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
    // --no-memory-gate: this asserts vitest's exit code, not the memory guard, which would otherwise
    // make a failing test indistinguishable from a refused run on a busy machine.
    expect(run([...cfg, "--no-memory-gate"])).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it("refuses a whole-suite run when memory is short, without starting vitest", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-tests-gate-"));
    let stderr = "";
    let status = 0;
    try {
      execFileSync(process.execPath, [script, "--root", dir], {
        cwd: dir,
        stdio: "pipe",
        env: { ...process.env, WEFT_LOCK_DIR: dir, WEFT_TEST_MIN_FREE_MB: "99999999" },
      });
    } catch (err) {
      const e = err as { status: number; stderr: Buffer };
      status = e.status;
      stderr = e.stderr.toString();
    }
    fs.rmSync(dir, { recursive: true, force: true });
    // With an impossible threshold the gate must refuse before vitest is ever spawned: exit 1 and the
    // reason on stderr, not vitest's "no test files" error.
    expect(status).toBe(1);
    expect(stderr).toContain("not starting a full sweep");
  }, 30_000);
});
