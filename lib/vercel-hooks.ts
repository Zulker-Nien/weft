import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { shell } from "./browser-tools";
import { globalSingleton } from "./global-singleton";
import { listCards } from "./store";

// Live pull of Vercel env variables into the 🔐 vault (docs/architecture/vercel.md). Vercel can't reach Weft on
// localhost, so a team webhook posts its env-variable events to the relay on the deployed Weft (lib/vercel-relay.ts),
// which saves a vercel_events row on Weft's Supabase; this server hears it through Realtime and asks Electron main to
// pull that project's folders (electron/vercel-env.cjs pull), where the Vercel token and the vault live. Values never
// pass through here: the event says which project changed, main reads the value and puts it in the vault.

// WEFT_VERCEL_RELAY_URL points hooks at another deployment (a preview, or your own fork's).
export const HOOK_URL = process.env.WEFT_VERCEL_RELAY_URL || "https://weft-topaz.vercel.app/api/vercel/webhook";
// Several variables added at once arrive as a burst: one pull after it settles.
export const SETTLE_MS = 1500;

const live = () =>
  globalSingleton("__weftVercelHooks", () => ({
    started: false,
    channel: null as RealtimeChannel | null,
    uid: null as string | null,
    timers: new Map<string, ReturnType<typeof setTimeout>>(),
  }));

const SIGN_IN = "Sign in to your Weft account first: live pull comes through it.";

interface Link {
  projectId: string;
  orgId: string;
}

// The folder's .vercel/project.json, the link the ▲ drawer (or `vercel link`) wrote.
export function linkOf(folder: string): Link | null {
  try {
    const link = JSON.parse(fs.readFileSync(path.join(folder, ".vercel", "project.json"), "utf8")) as Partial<Link>;
    return typeof link.projectId === "string" && typeof link.orgId === "string" ? { projectId: link.projectId, orgId: link.orgId } : null;
  } catch {
    return null;
  }
}

function teamOf(folder: string): string {
  const link = linkOf(folder);
  if (!link) throw new Error(`${path.basename(folder)} isn't linked to a Vercel project yet.`);
  if (!link.orgId.startsWith("team_")) throw new Error("Vercel webhooks belong to a team: link a project in a team (Pro or Enterprise).");
  return link.orgId;
}

async function userId(): Promise<string | null> {
  const { data } = await accountClient().auth.getSession();
  return data.session?.user.id ?? null;
}

// Which Vercel teams have a pull webhook on your Weft account; signedIn false when there's no account to ask.
export async function hookedTeams(): Promise<{ signedIn: boolean; teams: string[] }> {
  let uid: string | null;
  try {
    uid = await userId();
  } catch {
    // Accounts aren't set up in this build.
    return { signedIn: false, teams: [] };
  }
  if (!uid) return { signedIn: false, teams: [] };
  const { data, error } = await accountClient().from("vercel_hooks").select("team_id");
  if (error) throw new Error(error.message);
  return { signedIn: true, teams: (data as { team_id: string }[]).map((r) => r.team_id) };
}

// Puts a webhook on the folder's Vercel team that posts env-variable events to Weft's relay, starts listening, and
// pulls the folder once now so what's already on Vercel comes down too.
export async function addVercelHook(folder: string): Promise<{ team: string }> {
  if (!(await userId())) throw new Error(SIGN_IN);
  const team = teamOf(folder);
  const sb = accountClient();
  const found = await sb.from("vercel_hooks").select("id").eq("team_id", team).maybeSingle();
  if (found.error) throw new Error(found.error.message);
  if (!found.data) {
    // Our id goes in the hook's URL before Vercel makes its secret, so the row goes in whole, once.
    const id = randomUUID();
    const made = (await shell("/vercel/webhook-create", { teamId: team, url: `${HOOK_URL}?hook=${id}` })) as { id: string; secret: string };
    const { error } = await sb.from("vercel_hooks").insert({ id, team_id: team, vercel_hook_id: made.id, secret: made.secret });
    if (error) {
      await shell("/vercel/webhook-delete", { teamId: team, id: made.id }).catch(() => null);
      throw new Error(error.message);
    }
  }
  await listen();
  await pullFolder(folder);
  return { team };
}

// Takes the folder's team webhook off Vercel and your account. Nothing to do when signed out or there's none.
export async function removeVercelHook(folder: string): Promise<void> {
  if (!(await userId())) return;
  const team = teamOf(folder);
  const sb = accountClient();
  const { data, error } = await sb.from("vercel_hooks").select("id, vercel_hook_id").eq("team_id", team).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return;
  await shell("/vercel/webhook-delete", { teamId: team, id: data.vercel_hook_id });
  await sb.from("vercel_hooks").delete().eq("id", data.id);
  if (!(await hookedTeams()).teams.length) await stopListening();
}

// The board's folders (its cards' folders) linked to a Vercel project, by project id.
export function linkedFolders(): { folder: string; link: Link }[] {
  const seen = new Set<string>();
  const out: { folder: string; link: Link }[] = [];
  for (const card of listCards()) {
    if (!card.cwd || seen.has(card.cwd)) continue;
    seen.add(card.cwd);
    const link = linkOf(card.cwd);
    if (link) out.push({ folder: card.cwd, link });
  }
  return out;
}

async function pullFolder(folder: string) {
  try {
    await shell("/vercel/env-pull", { folder });
  } catch (err) {
    console.warn(`Vercel pull for ${folder}: ${(err as Error).message}`);
  }
}

// Pulls every board folder linked to the project an event came for.
export async function pullProject(projectId: string) {
  for (const { folder, link } of linkedFolders()) if (link.projectId === projectId) await pullFolder(folder);
}

function heard(projectId: string) {
  const g = live();
  clearTimeout(g.timers.get(projectId));
  g.timers.set(
    projectId,
    setTimeout(() => {
      g.timers.delete(projectId);
      void pullProject(projectId);
    }, SETTLE_MS),
  );
}

async function stopListening() {
  const g = live();
  if (g.channel) await accountClient().removeChannel(g.channel);
  g.channel = null;
  g.uid = null;
}

// One Realtime channel on your vercel_events rows (the table's select policy keeps it to yours).
async function listen() {
  const uid = await userId();
  const g = live();
  if (g.channel && g.uid === uid) return;
  await stopListening();
  if (!uid) return;
  g.uid = uid;
  g.channel = accountClient()
    .channel(`vercel-events-${uid}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "vercel_events", filter: `user_id=eq.${uid}` }, (change: { new: { project_id?: unknown } }) => {
      if (typeof change.new.project_id === "string") heard(change.new.project_id);
    })
    .subscribe();
}

// Listen while you're signed in and have a hook, and catch up on what changed while Weft wasn't listening: one pull
// of every folder on a hooked team. Stop otherwise.
export async function refreshVercelListener() {
  try {
    const { signedIn, teams } = await hookedTeams();
    if (!signedIn || !teams.length) {
      await stopListening();
      return;
    }
    const wasListening = Boolean(live().channel);
    await listen();
    if (!wasListening) for (const { folder, link } of linkedFolders()) if (teams.includes(link.orgId)) await pullFolder(folder);
  } catch (err) {
    console.warn(`Vercel webhooks: ${(err as Error).message}`);
  }
}

// Once per server process (from prewarm()): follows sign-in and sign-out, starting with the session it has now.
export function startVercelListener() {
  const g = live();
  if (g.started) return;
  g.started = true;
  try {
    // supabase-js warns against awaiting its calls inside this callback, so the refresh runs after it.
    accountClient().auth.onAuthStateChange(() => void setTimeout(() => void refreshVercelListener(), 0));
  } catch {
    // Accounts aren't set up in this build: no relay to listen to.
  }
}
