import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// push.sh against real git: a bare "origin" and a clone, all in a temp dir.
const SCRIPT = path.join(__dirname, "push.sh");
let tmp: string;
let work: string;
let data: string;

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
function commit(name: string) {
  fs.writeFileSync(path.join(work, name), name);
  git(work, "add", name);
  git(work, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", name);
}
function push() {
  const r = spawnSync("bash", [SCRIPT], { cwd: work, encoding: "utf8", env: { ...process.env, WEFT_DATA: data } });
  return { code: r.status, out: r.stdout + r.stderr };
}
const remoteHead = () => git(tmp, "--git-dir", "origin.git", "rev-parse", "main");

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-push-"));
  work = path.join(tmp, "work");
  data = path.join(tmp, "data");
  fs.mkdirSync(data);
  git(tmp, "init", "-q", "--bare", "-b", "main", "origin.git");
  git(tmp, "init", "-q", "-b", "main", "work");
  git(work, "remote", "add", "origin", path.join(tmp, "origin.git"));
  commit("a");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("push.sh", () => {
  it("sets the upstream on a branch's first push, then pushes new commits", () => {
    let r = push();
    expect(r.code).toBe(0);
    expect(r.out).toContain("sets its upstream");
    expect(remoteHead()).toBe(git(work, "rev-parse", "HEAD"));
    commit("b");
    r = push();
    expect(r.code).toBe(0);
    expect(r.out).toContain("Pushing 1 commit(s) on main to origin/main");
    expect(remoteHead()).toBe(git(work, "rev-parse", "HEAD"));
  });

  it("says so when there's nothing to push", () => {
    push();
    const r = push();
    expect(r.code).toBe(0);
    expect(r.out).toContain("Nothing to push");
  });

  it("doesn't push when Push on Done is off, and does when it's on", () => {
    fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ pushOnDone: false, projects: [] }, null, 2));
    let r = push();
    expect(r.code).toBe(0);
    expect(r.out).toContain("Push on Done is off");
    expect(spawnSync("git", ["--git-dir", path.join(tmp, "origin.git"), "rev-parse", "--verify", "main"]).status).not.toBe(0);
    fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ pushOnDone: true, projects: [] }, null, 2));
    r = push();
    expect(r.code).toBe(0);
    expect(remoteHead()).toBe(git(work, "rev-parse", "HEAD"));
  });

  it("skips a repo with no remote and a detached HEAD", () => {
    git(work, "remote", "remove", "origin");
    expect(push().out).toContain("no origin remote");
    git(work, "checkout", "-q", "--detach");
    const r = push();
    expect(r.code).toBe(0);
    expect(r.out).toContain("Detached HEAD");
  });

  it("fails without forcing when the remote has moved on", () => {
    push();
    const other = path.join(tmp, "other");
    git(tmp, "clone", "-q", path.join(tmp, "origin.git"), "other");
    fs.writeFileSync(path.join(other, "c"), "c");
    git(other, "add", "c");
    git(other, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c");
    git(other, "push", "-q");
    const theirs = remoteHead();
    commit("b");
    const r = push();
    expect(r.code).toBe(1);
    expect(remoteHead()).toBe(theirs);
  });
});
