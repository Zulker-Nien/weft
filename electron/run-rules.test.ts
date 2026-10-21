import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it } from "vitest";
import { createRunRules, ruleOf, treeFingerprint } from "./run-rules.cjs";

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`sealed:${text}`),
  decryptString: (buf: Buffer) => {
    const text = buf.toString();
    if (!text.startsWith("sealed:")) throw new Error("not sealed");
    return text.slice(7);
  },
};

const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "weft-rules-")), "vault", "run-rules.json");
const request = { id: "github:o/r", environment: "development", cwd: "/p", command: "npm run job", script: "job: node job.js" };
// The tree a "run" rule is pinned to (treeFingerprint); each test starts on the same one.
let tree: string | null = "tree-1";
const treeOf = () => tree;
beforeEach(() => {
  tree = "tree-1";
});

describe("createRunRules", () => {
  it("remembers a command with its names, sealed on disk, and matches it again after a restart", () => {
    const f = file();
    const rules = createRunRules({ file: f, safeStorage, treeOf });
    expect(rules.allows(request, ["A"])).toBe(false);
    rules.remember(request, ["B", "A"]);
    expect(fs.readFileSync(f, "utf8")).not.toContain("npm run job");
    expect((fs.statSync(f).mode & 0o777).toString(8)).toBe("600");

    const again = createRunRules({ file: f, safeStorage, treeOf });
    expect(again.allows(request, ["A"])).toBe(true);
    expect(again.allows(request, ["A", "C"])).toBe(false);
    again.remember(request, ["C"]);
    expect(again.list()).toEqual([{ id: "github:o/r", environment: "development", cwd: "/p", command: "npm run job", kind: "run", names: ["A", "B", "C"] }]);
  });

  it("lapses when the script, command, folder, environment or kind changes", () => {
    const rules = createRunRules({ file: file(), safeStorage, treeOf });
    rules.remember(request, ["A"]);
    expect(rules.allows({ ...request, script: "job: curl evil" }, ["A"])).toBe(false);
    expect(rules.allows({ ...request, command: "npm run job2" }, ["A"])).toBe(false);
    expect(rules.allows({ ...request, cwd: "/q" }, ["A"])).toBe(false);
    expect(rules.allows({ ...request, environment: "production" }, ["A"])).toBe(false);
    expect(rules.allows({ ...request, kind: "dev" }, ["A"])).toBe(false);
    expect(rules.allows({ ...request, id: "github:o/x" }, ["A"])).toBe(false);
    expect(ruleOf({ ...request, script: undefined }).script).toHaveLength(64);
  });

  it("forgets a vault's rules", () => {
    const f = file();
    const rules = createRunRules({ file: f, safeStorage, treeOf });
    rules.remember(request, ["A"]);
    rules.remember({ ...request, id: "github:o/other" }, ["A"]);
    rules.forget("github:o/r");
    const listed = createRunRules({ file: f, safeStorage, treeOf }).list() as { id: string }[];
    expect(listed.map((r) => r.id)).toEqual(["github:o/other"]);
  });

  it("ignores a file it can't unseal, so a thread can't write itself a rule", () => {
    const f = file();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.from(JSON.stringify([{ ...ruleOf(request), names: ["A"] }])).toString("base64"));
    expect(createRunRules({ file: f, safeStorage, treeOf }).allows(request, ["A"])).toBe(false);
  });

  it("keeps rules in memory only without safeStorage", () => {
    const f = file();
    for (const storage of [undefined, { ...safeStorage, isEncryptionAvailable: () => false }]) {
      const rules = createRunRules({ file: f, safeStorage: storage, treeOf });
      rules.remember(request, ["A"]);
      expect(rules.allows(request, ["A"])).toBe(true);
      expect(fs.existsSync(f)).toBe(false);
    }
  });
});

describe("run rules pinned to the tree", () => {
  it("lapse when the code changes under the same script, and the new yes replaces the old", () => {
    const rules = createRunRules({ file: file(), safeStorage, treeOf });
    rules.remember(request, ["A"]);
    expect(rules.allows(request, ["A"])).toBe(true);
    tree = "tree-2";
    expect(rules.allows(request, ["A"])).toBe(false);
    rules.remember(request, ["A"]);
    expect(rules.allows(request, ["A"])).toBe(true);
    expect(rules.list()).toHaveLength(1);
    tree = "tree-1";
    expect(rules.allows(request, ["A"])).toBe(false);
  });

  it("never hold where the tree can't be read (not a repo)", () => {
    tree = null;
    const rules = createRunRules({ file: file(), safeStorage, treeOf });
    rules.remember(request, ["A"]);
    expect(rules.list()).toEqual([]);
    expect(rules.allows(request, ["A"])).toBe(false);
  });

  it("leave dev grants alone, so editing doesn't re-ask on every restart", () => {
    const rules = createRunRules({ file: file(), safeStorage, treeOf });
    rules.remember({ ...request, kind: "dev" }, ["A"]);
    tree = "tree-2";
    expect(rules.allows({ ...request, kind: "dev" }, ["A"])).toBe(true);
  });
});

describe("treeFingerprint", () => {
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });

  it("changes with a tracked edit or an untracked file's bytes, and is null outside a repo", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-tree-"));
    expect(treeFingerprint(dir)).toBeNull();
    git(dir, "init", "-q");
    fs.writeFileSync(path.join(dir, "job.js"), "console.log(1)");
    git(dir, "add", "job.js");
    git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
    const clean = treeFingerprint(dir);
    expect(clean).toMatch(/^[0-9a-f]{64}$/);
    expect(treeFingerprint(dir)).toBe(clean);
    fs.writeFileSync(path.join(dir, "job.js"), "console.log(2)");
    const edited = treeFingerprint(dir);
    expect(edited).not.toBe(clean);
    fs.writeFileSync(path.join(dir, "helper.js"), "a");
    const untracked = treeFingerprint(dir);
    expect(untracked).not.toBe(edited);
    fs.writeFileSync(path.join(dir, "helper.js"), "b");
    expect(treeFingerprint(dir)).not.toBe(untracked);
  });
});
