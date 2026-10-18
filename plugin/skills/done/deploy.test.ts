import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// deploy.mjs against a real git repo, with the vercel and gh CLIs stubbed by scripts that answer from files in `fake/`.
const SCRIPT = path.join(__dirname, "deploy.mjs");
let tmp: string;
let work: string;
let fake: string;
let data: string;
let sha: string;
let short: string;

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const put = (name: string, value: unknown) =>
  fs.writeFileSync(path.join(fake, name), typeof value === "string" ? value : JSON.stringify(value));
// A stub CLI: prints fake/<file> for the first route pattern its args match, else fails like a logged-out CLI.
function stub(name: string, routes: [string, string][]) {
  const cases = routes.map(([match, file]) => `  *"${match}"*) cat "${fake}/${file}" 2>/dev/null || exit 1 ;;`).join("\n");
  const bin = path.join(fake, name);
  fs.writeFileSync(bin, `#!/bin/bash\ncase "$*" in\n${cases}\n  *) exit 1 ;;\nesac\n`, { mode: 0o755 });
  return bin;
}
// The deployments list over time: call n prints deploys-<n>.json while there is one, then deploys.json.
const SEQUENCE = `n=$(( $(cat "$F/n" 2>/dev/null || echo 0) + 1 )); echo $n > "$F/n"; f="$F/deploys-$n.json"; [ -f "$f" ] || f="$F/deploys.json"; cat "$f"`;
function stubVercel() {
  const bin = stub("vercel", [["/v9/projects/", "project.json"], ["inspect --logs", "logs.txt"]]);
  const sequence = `  */v6/deployments*) F="${fake}"; ${SEQUENCE} ;;\n`;
  fs.writeFileSync(bin, fs.readFileSync(bin, "utf8").replace('case "$*" in\n', `case "$*" in\n${sequence}`), { mode: 0o755 });
  return bin;
}
const deploying = (state: string, commit = sha, created = 1) => ({ url: `${commit.slice(0, 7)}.vercel.app`, readyState: state, created, meta: { githubCommitSha: commit } });
const list = (...deployments: object[]) => ({ deployments });
function deploy(wait: Record<string, string> = {}) {
  const env = {
    ...process.env,
    THREADBOARD_DATA: data,
    DEPLOY_WAIT_MS: "300",
    DEPLOY_BUILD_WAIT_MS: "3000",
    DEPLOY_POLL_MS: "50",
    ...wait,
    VERCEL_BIN: stubVercel(),
    GH_BIN: stub("gh", [["repos/aimhuge/weft", "repo-id"], ["repositories/", "old-repo.json"]]),
  };
  const r = spawnSync("node", [SCRIPT], { cwd: work, encoding: "utf8", env });
  return { code: r.status, out: r.stdout + r.stderr };
}
const linked = (link: object | undefined, extra: object = {}) =>
  put("project.json", { id: "prj_1", name: "weft", link, gitProviderOptions: { createDeployments: "enabled" }, ...extra });
const GITHUB = { type: "github", org: "aimhuge", repo: "weft", repoId: 222 };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-deploy-"));
  work = path.join(tmp, "work");
  fake = path.join(tmp, "fake");
  data = path.join(tmp, "data");
  for (const dir of [work, fake, data]) fs.mkdirSync(dir);
  git(work, "init", "-q", "-b", "main");
  git(work, "remote", "add", "origin", "git@github.com:aimhuge/weft.git");
  fs.writeFileSync(path.join(work, "a"), "a");
  git(work, "add", "a");
  git(work, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "a");
  sha = git(work, "rev-parse", "HEAD");
  short = sha.slice(0, 7);
  fs.mkdirSync(path.join(work, ".vercel"));
  fs.writeFileSync(path.join(work, ".vercel/project.json"), JSON.stringify({ projectId: "prj_1", orgId: "team_1", projectName: "weft" }));
  put("repo-id", "222");
  put("old-repo.json", { full_name: "aimhuge/weft-history" });
  put("deploys.json", { deployments: [] });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("deploy.mjs", () => {
  it("waits for HEAD's build to finish and reports the deployment", () => {
    linked(GITHUB);
    put("deploys-1.json", list(deploying("QUEUED")));
    put("deploys-2.json", list(deploying("BUILDING")));
    put("deploys.json", list(deploying("READY")));
    const r = deploy();
    expect(r.code).toBe(0);
    expect(r.out).toContain(`Vercel is QUEUED ${short}`);
    expect(r.out).toContain(`Vercel is BUILDING ${short}`);
    expect(r.out).toContain(`Deployed ${short} on Vercel (weft): https://${short}.vercel.app`);
  });

  it("waits behind deploys already running, past the wait for HEAD's to appear", () => {
    linked(GITHUB);
    for (let n = 1; n <= 6; n++) put(`deploys-${String(n)}.json`, list(deploying("BUILDING", "a".repeat(40))));
    put("deploys.json", list(deploying("READY"), deploying("READY", "a".repeat(40))));
    const r = deploy({ DEPLOY_WAIT_MS: "100" });
    expect(r.code).toBe(0);
    expect(r.out).toContain(`Waiting on 1 running deploy(s) before ${short}`);
    expect(r.out).toContain(`Deployed ${short}`);
  });

  it("exits 3 with the build log when the build fails", () => {
    linked(GITHUB);
    put("deploys.json", list(deploying("ERROR")));
    put("logs.txt", "Compiled\nType error: x is not a string\nError: Command \"next build\" exited with 1");
    const r = deploy();
    expect(r.code).toBe(3);
    expect(r.out).toContain(`Vercel's build of ${short} failed: https://${short}.vercel.app. Production stays on the last good deploy.`);
    expect(r.out).toContain("Type error: x is not a string");
  });

  it("follows a newer deployment when Vercel cancels HEAD's, and fails when there's none", () => {
    linked(GITHUB);
    const newer = "b".repeat(40);
    put("deploys-1.json", list(deploying("BUILDING", newer, 2), deploying("CANCELED", sha, 1)));
    put("deploys.json", list(deploying("READY", newer, 2), deploying("CANCELED", sha, 1)));
    let r = deploy();
    expect(r.code).toBe(0);
    expect(r.out).toContain(`Vercel superseded ${short} with bbbbbbb`);
    put("deploys.json", list(deploying("CANCELED")));
    fs.rmSync(path.join(fake, "deploys-1.json"));
    r = deploy();
    expect(r.code).toBe(2);
    expect(r.out).toContain("nothing newer is building");
  });

  it("gives up on a build still running after the whole wait", () => {
    linked(GITHUB);
    put("deploys.json", list(deploying("BUILDING")));
    const r = deploy({ DEPLOY_BUILD_WAIT_MS: "200" });
    expect(r.code).toBe(2);
    expect(r.out).toContain(`Vercel is still BUILDING ${short} after 0 min`);
  });

  it("catches a Vercel project still linked to a renamed repo, by id", () => {
    linked({ ...GITHUB, repoId: 111 });
    const r = deploy();
    expect(r.code).toBe(2);
    expect(r.out).toContain("deploys from aimhuge/weft-history, not origin (aimhuge/weft)");
    expect(r.out).toContain("vercel git connect git@github.com:aimhuge/weft.git");
  });

  it("compares names when gh can't say the repo's id", () => {
    fs.rmSync(path.join(fake, "repo-id"));
    linked({ ...GITHUB, repo: "other" });
    expect(deploy()).toMatchObject({ code: 2 });
    linked(GITHUB);
    put("deploys.json", { deployments: [{ url: "x.vercel.app", state: "READY", meta: { githubCommitSha: sha } }] });
    expect(deploy()).toMatchObject({ code: 0 });
  });

  it("fails when the project isn't connected to git or git deploys are off", () => {
    linked(undefined);
    let r = deploy();
    expect(r.code).toBe(2);
    expect(r.out).toContain("isn't connected to git");
    linked(GITHUB, { gitProviderOptions: { createDeployments: "disabled" } });
    r = deploy();
    expect(r.code).toBe(2);
    expect(r.out).toContain("git deployments turned off");
  });

  it("fails when no deployment of HEAD shows up in time", () => {
    linked(GITHUB);
    put("deploys.json", list(deploying("READY", "0".repeat(40))));
    const r = deploy();
    expect(r.code).toBe(2);
    expect(r.out).toContain(`hasn't started a deployment of ${sha.slice(0, 7)}`);
  });

  it("has nothing to deploy with no Vercel link, Push on Done off, or a logged-out CLI", () => {
    linked(GITHUB);
    fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ pushOnDone: false }));
    const expectZero = (text: string) => {
      const r = deploy();
      expect(r.code).toBe(0);
      expect(r.out).toContain(text);
    };
    expectZero("Push on Done is off");
    fs.rmSync(path.join(data, "settings.json"));
    fs.rmSync(path.join(fake, "project.json"));
    expectZero("deploy not checked");
    fs.rmSync(path.join(work, ".vercel"), { recursive: true });
    expectZero("No Vercel project linked");
  });
});
