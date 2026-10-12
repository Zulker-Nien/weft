import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanDiff } from "./secret-scan.mjs";

// Built from pieces so this file doesn't hold a whole key shape itself.
const STRIPE = ["sk", "live", "51HabcdefghijklmnopqrstuvWX"].join("_");

describe("scanDiff", () => {
  it("finds a key on an added line with its file and line, and skips the rest", () => {
    const diff = [
      "diff --git a/lib/pay.ts b/lib/pay.ts",
      "--- a/lib/pay.ts",
      "+++ b/lib/pay.ts",
      "@@ -10,0 +11,3 @@",
      "+const ok = 1;",
      `+const key = "${STRIPE}";`,
      `+const allowed = "${STRIPE}"; // gitleaks:allow`,
      `-const removed = "${STRIPE}";`,
      "+++ b/lib/pay.test.ts",
      "@@ -1,0 +1 @@",
      `+const fixture = "${STRIPE}";`,
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      `+not a file "${STRIPE}"`,
    ].join("\n");
    expect(scanDiff(diff)).toEqual([{ file: "lib/pay.ts", line: 12, kind: "a Stripe secret key", preview: "sk_live_…uvWX" }]);
    expect(scanDiff("")).toEqual([]);
  });

  it("fails a staged key and passes a clean commit when run as the hook does", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "weft-scan-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    const scan = () => {
      try {
        execFileSync("node", ["--no-warnings", path.join(__dirname, "secret-scan.mjs")], { cwd: repo, encoding: "utf8", stdio: "pipe" });
        return { code: 0, err: "" };
      } catch (err) {
        const e = err as { status: number; stderr: string };
        return { code: e.status, err: e.stderr };
      }
    };
    git("init", "-q");
    fs.writeFileSync(path.join(repo, "a.ts"), "export const a = 1;\n");
    git("add", ".");
    expect(scan()).toEqual({ code: 0, err: "" });
    fs.writeFileSync(path.join(repo, "a.ts"), `export const a = "${STRIPE}";\n`);
    git("add", ".");
    const { code, err } = scan();
    expect(code).toBe(1);
    expect(err).toContain("a.ts:1  a Stripe secret key  sk_live_…uvWX");
  });
});
