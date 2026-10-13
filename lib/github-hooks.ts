import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { globalSingleton } from "./global-singleton";
import { ghError, issueSyncFolders, issueSyncStatus, repoOf, syncIssues } from "./github-issues";

// Instant GitHub issue sync, by webhook (docs/architecture/github-issues.md). GitHub can't reach Weft on localhost,
// so a repo's webhook posts to the relay on the deployed Weft (lib/github-relay.ts, on Vercel), which saves a
// github_events row on Weft's Supabase; this server hears it through Realtime and syncs the folders on that repo. Hooks belong to your Weft account (github_hooks); the 5-minute poll stays on as
// the fallback, so a missed event costs at most 5 minutes.

// WEFT_RELAY_URL points hooks at another deployment (a preview, or your own fork's).
export const HOOK_URL = process.env.WEFT_RELAY_URL || "https://weft-topaz.vercel.app/api/github/webhook";
// GitHub sends a burst for one change (opened, then labeled): one sync after it settles.
export const SETTLE_MS = 1500;

// Read afresh each time, so a test that deletes the key starts clean.
const live = () =>
  globalSingleton("__weftGithubHooks", () => ({
    started: false,
    channel: null as RealtimeChannel | null,
    uid: null as string | null,
    timers: new Map<string, ReturnType<typeof setTimeout>>(),
  }));

const SIGN_IN = "Sign in to your Weft account first: instant updates come through it.";

async function userId(): Promise<string | null> {
  const { data } = await accountClient().auth.getSession();
  return data.session?.user.id ?? null;
}

// gh api with a JSON body on stdin, so the hook's secret never shows in a process list.
function ghApi(args: string[], folder: string, body?: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("gh", ["api", ...args, ...(body === undefined ? [] : ["--input", "-"])], { cwd: folder, timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(new Error(err.message), { code: err.code, stderr }));
      else resolve(stdout);
    });
    child.stdin?.end(body === undefined ? "" : JSON.stringify(body));
  });
}

const httpStatus = (err: unknown) => /HTTP (\d{3})/.exec(`${(err as { stderr?: string }).stderr ?? ""} ${(err as Error).message}`)?.[1];

export function hookError(err: unknown, repo: string, folder: string) {
  const status = httpStatus(err);
  if (status === "404" || status === "403") return `Adding a webhook to ${repo} needs admin rights on it.`;
  return ghError(err, folder);
}

// Which repos have a webhook on your Weft account; signedIn false when there's no account to ask.
export async function hookedRepos(): Promise<{ signedIn: boolean; repos: string[] }> {
  let uid: string | null;
  try {
    uid = await userId();
  } catch {
    // Accounts aren't set up in this build.
    return { signedIn: false, repos: [] };
  }
  if (!uid) return { signedIn: false, repos: [] };
  const { data, error } = await accountClient().from("github_hooks").select("repo");
  if (error) throw new Error(error.message);
  return { signedIn: true, repos: (data as { repo: string }[]).map((r) => r.repo) };
}

// Puts a webhook on the folder's repo that posts its issue events to Weft's relay, and starts listening.
export async function addHook(folder: string): Promise<{ repo: string }> {
  if (!(await userId())) throw new Error(SIGN_IN);
  const repo = await repoOf(folder);
  const sb = accountClient();
  const found = await sb.from("github_hooks").select("id").eq("repo", repo).maybeSingle();
  if (found.error) throw new Error(found.error.message);
  if (!found.data) {
    const secret = randomBytes(32).toString("hex");
    const { data, error } = await sb.from("github_hooks").insert({ repo, secret }).select("id").single();
    if (error) throw new Error(error.message);
    const id = String(data.id);
    try {
      const config = { url: `${HOOK_URL}?hook=${id}`, content_type: "json", secret, insecure_ssl: "0" };
      const made = JSON.parse(await ghApi([`repos/${repo}/hooks`, "--method", "POST"], folder, { name: "web", active: true, events: ["issues"], config })) as { id?: number };
      if (made.id) await sb.from("github_hooks").update({ github_hook_id: made.id }).eq("id", id);
    } catch (err) {
      await sb.from("github_hooks").delete().eq("id", id);
      throw new Error(hookError(err, repo, folder));
    }
  }
  await listen();
  return { repo };
}

// Takes the folder's repo's webhook off GitHub and your account. Nothing to do when signed out or there's none.
export async function removeHook(folder: string): Promise<void> {
  if (!(await userId())) return;
  const repo = await repoOf(folder);
  const sb = accountClient();
  const { data, error } = await sb.from("github_hooks").select("id, github_hook_id").eq("repo", repo).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return;
  const row = data;
  if (row.github_hook_id) {
    try {
      await ghApi([`repos/${repo}/hooks/${row.github_hook_id}`, "--method", "DELETE"], folder);
    } catch (err) {
      // Already gone from GitHub: still forget it here.
      if (httpStatus(err) !== "404") throw new Error(hookError(err, repo, folder));
    }
  }
  await sb.from("github_hooks").delete().eq("id", row.id);
  if (!(await hookedRepos()).repos.length) await stopListening();
}

// Syncs every synced folder on the repo an event came for.
export async function syncRepo(repo: string) {
  const key = repo.toLowerCase();
  const last = issueSyncStatus();
  for (const folder of issueSyncFolders()) {
    const folderRepo = last[folder]?.repo ?? (await repoOf(folder).catch(() => null));
    if (folderRepo?.toLowerCase() !== key) continue;
    await syncIssues(folder).catch((err: unknown) => console.warn(`GitHub issues for ${folder}: ${(err as Error).message}`));
  }
}

function heard(repo: string) {
  const key = repo.toLowerCase();
  const g = live();
  clearTimeout(g.timers.get(key));
  g.timers.set(
    key,
    setTimeout(() => {
      g.timers.delete(key);
      void syncRepo(repo);
    }, SETTLE_MS),
  );
}

async function stopListening() {
  const g = live();
  if (g.channel) await accountClient().removeChannel(g.channel);
  g.channel = null;
  g.uid = null;
}

// One Realtime channel on your github_events rows (the table's select policy keeps it to yours).
async function listen() {
  const uid = await userId();
  const g = live();
  if (g.channel && g.uid === uid) return;
  await stopListening();
  if (!uid) return;
  g.uid = uid;
  g.channel = accountClient()
    .channel(`github-events-${uid}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "github_events", filter: `user_id=eq.${uid}` }, (change: { new: { repo?: unknown } }) => {
      if (typeof change.new.repo === "string") heard(change.new.repo);
    })
    .subscribe();
}

// Listen while you're signed in and have a hook; stop otherwise.
export async function refreshHookListener() {
  try {
    const { signedIn, repos } = await hookedRepos();
    if (signedIn && repos.length) await listen();
    else await stopListening();
  } catch (err) {
    console.warn(`GitHub webhooks: ${(err as Error).message}`);
  }
}

// Once per server process (from prewarm()): follows sign-in and sign-out, starting with the session it has now.
export function startHookListener() {
  const g = live();
  if (g.started) return;
  g.started = true;
  try {
    // supabase-js warns against awaiting its calls inside this callback, so the refresh runs after it.
    accountClient().auth.onAuthStateChange(() => void setTimeout(() => void refreshHookListener(), 0));
  } catch {
    // Accounts aren't set up in this build: no relay to listen to.
  }
}
