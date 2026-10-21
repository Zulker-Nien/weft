// deploy-poll.mjs — one poll of deploy.mjs's wait loop, as a pure decision so it's testable without the CLIs.
//
// A poll's deployments list can come back empty or not at all (a flaky `vercel api`), so deploy.mjs remembers
// the target's deployment once seen and refreshes it by id. A failed read means "try again next poll", never
// "Vercel hasn't started", which only fires when no poll ever saw the target's deployment.
export const ACTIVE = new Set(["QUEUED", "INITIALIZING", "BUILDING"]);
export const stateOf = (d) => d.readyState ?? d.state ?? "QUEUED";
export const short = (s) => s.slice(0, 7);
const minutes = (ms) => `${String(Math.round(ms / 60_000))} min`;

// The target commit's deployment in a poll's list (null when the read failed).
export const findTarget = (list, target) => list?.find((d) => d.meta?.githubCommitSha === target);

const where = (name) => `check Vercel → ${name} → Deployments`;

// A deployment that has stopped for good: READY exits 0, ERROR exits 3 with the build log's url.
const settled = (mine, head, target, name) => {
  const state = stateOf(mine);
  if (state === "READY") {
    return { code: 0, line: `Deployed ${short(head)} on Vercel (${name}): https://${mine.url}` };
  }
  if (state === "ERROR") {
    return {
      code: 3,
      url: mine.url,
      line: `Vercel's build of ${short(target)} failed: https://${mine.url}. Production stays on the last good deploy.`,
    };
  }
  return null;
};

// A deployment a newer push superseded: follow the newer one, or give up when nothing newer is building.
const superseded = (list, mine, head, target, name) => {
  if (stateOf(mine) !== "CANCELED" || !list) return null;
  const newer = list.find((d) => (d.created ?? 0) > (mine.created ?? 0) && d.meta?.githubCommitSha);
  if (!newer) {
    return { code: 2, line: `Vercel canceled the deployment of ${short(target)} and nothing newer is building: ${where(name)}.` };
  }
  const sha = newer.meta.githubCommitSha;
  return { follow: sha, deployment: newer, line: `Vercel superseded ${short(head)} with ${short(sha)}: following that deployment.` };
};

// Waiting long enough with nothing building for the target: Vercel never started it.
const neverStarted = ({ list, seen, waited, wait, head }) => {
  if (!list || seen || waited < wait) return null;
  const others = list.filter((d) => ACTIVE.has(stateOf(d)) && d.meta?.githubCommitSha);
  if (others.length) return null;
  return { code: 2, line: `Vercel hasn't started a deployment of ${short(head)} after ${String(Math.round(wait / 1000))}s` };
};

// Past the build deadline: still going, or unreadable. Either way this poll ends the wait.
const outOfTime = ({ waited, mine, running, target, head, apiFailed, name }) => {
  if (apiFailed) {
    const last = mine ? ` (last seen ${stateOf(mine)} ${short(target)}: https://${mine.url})` : "";
    return {
      code: 2,
      line: `Couldn't read Vercel's deployments after ${minutes(waited)} (\`vercel api\` failed)${last}: ${where(name)}.`,
    };
  }
  const what = mine
    ? `${stateOf(mine)} ${short(target)}`
    : `running ${String(running.length)} deploy(s) ahead of ${short(head)}`;
  return { code: 2, line: `Vercel is still ${what} after ${minutes(waited)}: ${where(name)}.` };
};

// list: this poll's deployments, or null when the read failed. mine: the target's deployment (from the list,
// else refreshed by id, else the last one seen), or null. seen: whether any poll ever saw it. apiFailed: whether
// this poll's reads failed. Returns { code, line } to exit (code 3 also carries url, for the build log),
// { follow, line } to switch to a newer commit's deployment, or { note } to print before polling again.
export function pollStep({ list, mine, seen, apiFailed, waited, wait, buildWait, head, target, name }) {
  const running = (list ?? []).filter((d) => ACTIVE.has(stateOf(d)) && d.meta?.githubCommitSha !== target);
  if (mine) {
    const done = settled(mine, head, target, name);
    if (done) return done;
    const next = superseded(list, mine, head, target, name);
    if (next) return next;
  }
  const late = neverStarted({ list, seen, waited, wait, head });
  if (late) return { ...late, line: `${late.line}: ${where(name)}.` };
  if (waited >= buildWait) return outOfTime({ waited, mine, running, target, head, apiFailed, name });
  if (mine) return { note: `Vercel is ${stateOf(mine)} ${short(target)}: https://${mine.url}` };
  if (apiFailed) return { note: "Couldn't read Vercel's deployments: trying again…" };
  return { note: `Waiting on ${String(running.length)} running deploy(s) before ${short(head)}…` };
}