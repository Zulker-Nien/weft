#!/usr/bin/env node
// deploy.mjs — Phase 4, after push.sh: did the push deploy?
// Usage: node deploy.mjs   (from the repo root)
//
// A project linked to Vercel (.vercel/project.json) deploys by Vercel's git integration: the push is
// the deploy. That breaks silently when the Vercel project points at another repo (origin was
// re-created or renamed and Vercel kept the old repo's id) or isn't connected to git at all. This
// checks the link against origin, then waits for the deployment of HEAD to finish (behind any deploys
// already running), so a failed build is caught here instead of on the live site.
//
// It never runs `vercel deploy` itself: that uploads the working tree, and this tree holds other
// cards' uncommitted work. A git deploy builds exactly the pushed commit.
//
// Exit 0: deployed (prints its url), or nothing to deploy (Push on Done off, no Vercel link, no vercel
//         CLI or not logged in: it says which).
// Exit 2: not deployed (no git link, wrong repo, git deploys off, no deployment of HEAD, canceled, or
//         still building after the wait): the card goes to Review with what it prints.
// Exit 3: the build failed. It prints the url and the tail of the build log, for the wrap-up to fix and
//         push again; Vercel never promotes a failed build, so production stays on the last good deploy.
// It takes as long as the build (Weft's is ~15 min), so run it in the background.
// Env: WEFT_DATA (Weft's data dir), DEPLOY_WAIT_MS (for HEAD's deployment to appear once nothing
//      else runs; default 90000), DEPLOY_BUILD_WAIT_MS (the whole wait; default 1800000), DEPLOY_POLL_MS
//      (default 10000), VERCEL_BIN / GH_BIN (the CLIs, for tests).
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VERCEL = process.env.VERCEL_BIN || "vercel";
const GH = process.env.GH_BIN || "gh";
const WAIT = Number(process.env.DEPLOY_WAIT_MS ?? 90_000);
const BUILD_WAIT = Number(process.env.DEPLOY_BUILD_WAIT_MS ?? 1_800_000);
const POLL = Number(process.env.DEPLOY_POLL_MS ?? 10_000);

const say = (line) => console.log(line);
function done(code, line) {
  say(line);
  process.exit(code);
}
function run(bin, args) {
  try {
    return execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}
// The tail of a deployment's build log, where the error is (the CLI writes it to stdout or stderr).
function buildLog(url, lines = 40) {
  const r = spawnSync(VERCEL, ["inspect", "--logs", url], { encoding: "utf8" });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  return text ? text.split("\n").slice(-lines).join("\n") : "(no log: open the url above)";
}
function json(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}
const readJson = (file) => (fs.existsSync(file) ? json(fs.readFileSync(file, "utf8")) : null);

const settings = path.join(process.env.WEFT_DATA || path.join(os.homedir(), ".weft"), "settings.json");
if (readJson(settings)?.pushOnDone === false) done(0, "Push on Done is off in Weft's Settings: nothing pushed, nothing deployed.");

const link = readJson(".vercel/project.json");
if (!link?.projectId) done(0, "No Vercel project linked here (.vercel/project.json): the push is the last step.");

const team = link.orgId ? `teamId=${link.orgId}` : "";
const api = (route) => json(run(VERCEL, ["api", `${route}${route.includes("?") ? "&" : "?"}${team}`]));
const project = api(`/v9/projects/${link.projectId}`);
if (!project?.id) done(0, `Couldn't read Vercel project ${link.projectName ?? link.projectId} (vercel CLI missing or logged out): deploy not checked.`);

const name = project.name ?? link.projectName;
const origin = run("git", ["remote", "get-url", "origin"]) ?? "";
const slug = origin.match(/github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/)?.[1];
const fix = `run \`vercel git disconnect --yes && vercel git connect ${origin || "<origin url>"} --yes\` here (or Vercel → ${name} → Settings → Git)`;

if (!project.link?.type) done(2, `Vercel project ${name} isn't connected to git, so pushes don't deploy: ${fix}.`);
if (project.gitProviderOptions?.createDeployments === "disabled") {
  done(2, `Vercel project ${name} has git deployments turned off: turn them on in Vercel → ${name} → Settings → Git.`);
}
if (slug && project.link.type === "github") {
  // By id: Vercel keeps the name it saw when it was linked, so a renamed repo still reads as origin's name.
  const id = run(GH, ["api", `repos/${slug}`, "--jq", ".id"]);
  const linked = `${project.link.org}/${project.link.repo}`;
  if (id ? String(project.link.repoId) !== id : linked.toLowerCase() !== slug.toLowerCase()) {
    const actual = (id && json(run(GH, ["api", `repositories/${project.link.repoId}`]))?.full_name) || linked;
    done(2, `Vercel project ${name} deploys from ${actual}, not origin (${slug}), so pushes here don't deploy: ${fix}.`);
  }
}

// Waits for the deployment of HEAD to finish, and for the running deploys ahead of it: Vercel queues a
// push behind builds already running, so HEAD's deployment can take a while to appear.
const ACTIVE = new Set(["QUEUED", "INITIALIZING", "BUILDING"]);
const stateOf = (d) => d.readyState ?? d.state ?? "QUEUED";
const short = (s) => s.slice(0, 7);
const minutes = (ms) => `${String(Math.round(ms / 60_000))} min`;
const head = run("git", ["rev-parse", "HEAD"]) ?? "";
let target = head;
const start = Date.now();
let said = "";
const note = (line) => {
  if (line !== said) say((said = line));
};
for (;;) {
  const list = api(`/v6/deployments?projectId=${link.projectId}&limit=20`)?.deployments ?? [];
  const mine = list.find((d) => d.meta?.githubCommitSha === target);
  const running = list.filter((d) => ACTIVE.has(stateOf(d)) && d !== mine);
  const state = mine ? stateOf(mine) : "";
  if (state === "READY") done(0, `Deployed ${short(head)} on Vercel (${name}): https://${mine.url}`);
  if (state === "ERROR") {
    say(`Vercel's build of ${short(target)} failed: https://${mine.url}. Production stays on the last good deploy.`);
    done(3, `--- last lines of the build log (\`vercel inspect --logs ${mine.url}\`) ---\n${buildLog(mine.url)}`);
  }
  if (state === "CANCELED") {
    // A newer push superseded it; the newest deployment carries this commit too, so follow that one.
    const newer = list.find((d) => (d.created ?? 0) > (mine.created ?? 0) && d.meta?.githubCommitSha);
    if (!newer) done(2, `Vercel canceled the deployment of ${short(target)} and nothing newer is building: check Vercel → ${name} → Deployments.`);
    target = newer.meta.githubCommitSha;
    say(`Vercel superseded ${short(head)} with ${short(target)}: following that deployment.`);
    continue;
  }
  const waited = Date.now() - start;
  if (!mine && !running.length && waited >= WAIT) {
    done(2, `Vercel hasn't started a deployment of ${short(head)} after ${String(Math.round(WAIT / 1000))}s: check Vercel → ${name} → Deployments.`);
  }
  if (waited >= BUILD_WAIT) {
    const what = mine ? `${state} ${short(target)}` : `running ${String(running.length)} deploy(s) ahead of ${short(head)}`;
    done(2, `Vercel is still ${what} after ${minutes(waited)}: check Vercel → ${name} → Deployments.`);
  }
  note(mine ? `Vercel is ${state} ${short(target)}: https://${mine.url}` : `Waiting on ${String(running.length)} running deploy(s) before ${short(head)}…`);
  await new Promise((r) => setTimeout(r, POLL));
}
