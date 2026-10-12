import { folderName } from "./format";

// What the Supabase drawer shows, from what Electron main's Supabase side (electron/supabase.cjs) sends. The
// token never reaches the board: main keeps it in the Keychain and makes every call.

// A folder's link: just the ref until Supabase answers, then the project.
export interface SupabaseLink {
  ref: string;
  // "cli": supabase/.temp/project-ref (what `supabase link` writes); "mcp": the Supabase server in .mcp.json.
  source: "cli" | "mcp";
  name: string | null;
  org?: string | null;
  region?: string | null;
  // ACTIVE_HEALTHY, INACTIVE (paused), COMING_UP, RESTORING, …
  status?: string;
  // The project's API URL, https://<ref>.supabase.co.
  url?: string;
  // The folder's migrations Supabase hasn't applied, or null when it can't say.
  pending?: string[] | null;
}

export interface SupabaseFolder {
  folder: string;
  // The folder's GitHub remote, owner/name.
  repo: string | null;
  // How many migrations the folder has in supabase/migrations.
  migrations: number;
  link: SupabaseLink | null;
  // Supabase couldn't read the linked project.
  error: string | null;
}

export interface SupabaseStatus {
  signedIn: boolean;
  // The organizations the token reaches, by name; null until it's checked.
  orgs: string[] | null;
  // The saved token didn't work.
  error: string | null;
  folders: SupabaseFolder[];
}

export interface SupabaseProject {
  ref: string;
  name: string;
  org: string | null;
  region: string | null;
  status: string;
  createdAt: number;
}

// window.threadboard.supabase, from electron/preload.cjs.
export interface SupabaseBridge {
  status(folders: string[]): Promise<SupabaseStatus>;
  setToken(token: string): Promise<{ orgs: string[] }>;
  forgetToken(): Promise<{ signedIn: false }>;
  projects(): Promise<SupabaseProject[]>;
  link(folder: string, ref: string): Promise<{ linked: true; name: string }>;
  unlink(folder: string): Promise<{ linked: false }>;
  restore(ref: string): Promise<{ restoring: true }>;
}

export const TOKEN_URL = "https://supabase.com/dashboard/account/tokens";
export const NEW_PROJECT_URL = "https://supabase.com/dashboard/new";

export function supabaseBridge(): SupabaseBridge | null {
  return (typeof window !== "undefined" && window.threadboard?.supabase) || null;
}

// The desktop shell started before Supabase was added: its preload has no bridge, or its main no handlers.
export function needsRestart(hasShell: boolean, bridge: SupabaseBridge | null, error: string | null) {
  return (hasShell && !bridge) || (!!error && error.includes("No handler registered for 'supabase:"));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// How well a project fits a folder: 2 has the repo's or folder's name, 1 a name that contains it either way, 0 none.
export function matchScore(project: Pick<SupabaseProject, "name">, folder: Pick<SupabaseFolder, "folder" | "repo">) {
  const names = [folderName(folder.folder), folder.repo?.split("/")[1] ?? ""].map(norm).filter(Boolean);
  const name = norm(project.name);
  if (names.includes(name)) return 2;
  if (name && names.some((n) => n.includes(name) || name.includes(n))) return 1;
  return 0;
}

// The picker's list: projects matching the search (name, org or ref), best fits for the folder first, then newest.
export function pickerList(projects: SupabaseProject[], folder: Pick<SupabaseFolder, "folder" | "repo">, search = "") {
  const q = search.trim().toLowerCase();
  return projects
    .filter((p) => !q || [p.name, p.org ?? "", p.ref].some((s) => s.toLowerCase().includes(q)))
    .map((p) => ({ project: p, score: matchScore(p, folder) }))
    .sort((a, b) => b.score - a.score || b.project.createdAt - a.project.createdAt);
}

const STATES: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  ACTIVE_HEALTHY: { label: "Healthy", tone: "ok" },
  ACTIVE_UNHEALTHY: { label: "Unhealthy", tone: "bad" },
  INACTIVE: { label: "Paused", tone: "muted" },
  COMING_UP: { label: "Starting", tone: "warn" },
  RESTORING: { label: "Restoring", tone: "warn" },
  RESTARTING: { label: "Restarting", tone: "warn" },
  UPGRADING: { label: "Upgrading", tone: "warn" },
  RESIZING: { label: "Resizing", tone: "warn" },
  PAUSING: { label: "Pausing", tone: "warn" },
  GOING_DOWN: { label: "Stopping", tone: "warn" },
  INIT_FAILED: { label: "Failed to start", tone: "bad" },
  RESTORE_FAILED: { label: "Restore failed", tone: "bad" },
  PAUSE_FAILED: { label: "Pause failed", tone: "bad" },
  REMOVED: { label: "Removed", tone: "bad" },
};

export function projectState(status: string) {
  return STATES[status] ?? { label: status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " "), tone: "muted" as const };
}

// The line about the folder's migrations: none, all applied, or how many Supabase hasn't run yet.
export function migrationLine(f: Pick<SupabaseFolder, "migrations">, link: Pick<SupabaseLink, "pending">): { text: string; warn: boolean } | null {
  if (!f.migrations) return null;
  const all = `${f.migrations} migration${f.migrations === 1 ? "" : "s"}`;
  if (!link.pending) return { text: all, warn: false };
  if (!link.pending.length) return { text: `${all}, all applied`, warn: false };
  const n = link.pending.length;
  return { text: `${n} of ${all} not applied: ${link.pending.slice(0, 2).join(", ")}${n > 2 ? ", …" : ""}`, warn: true };
}

// The linked card's row of supabase.com shortcuts into the project's dashboard, short enough for one line.
export function supabaseActions(ref: string): { label: string; url: string }[] {
  const base = `https://supabase.com/dashboard/project/${ref}`;
  return [
    { label: "Auth", url: `${base}/auth/users` },
    { label: "Logs", url: `${base}/logs/explorer` },
    { label: "Keys", url: `${base}/settings/api-keys` },
    { label: "Usage", url: `${base}/settings/billing/usage` },
    { label: "Dash", url: base },
  ];
}

// The folders the drawer shows: the top bar's project only, or every one.
export function shownFolders(folders: SupabaseFolder[], project: string | null) {
  return project ? folders.filter((f) => f.folder === project) : folders;
}

// Who the token is, under the drawer's header.
export function signedInLine(orgs: string[] | null) {
  if (!orgs?.length) return "Signed in";
  return orgs.length > 2 ? `Signed in · ${orgs.slice(0, 2).join(", ")} +${orgs.length - 2}` : `Signed in · ${orgs.join(", ")}`;
}

// The rail icon's hover text.
export function supabaseTitle(status: SupabaseStatus | null, project: string | null) {
  if (!status?.signedIn) return "Supabase: link this project";
  const linked = shownFolders(status.folders, project).filter((f) => f.link);
  if (!linked.length) return "Supabase: not linked yet";
  return `Supabase: ${linked.map((f) => f.link?.name ?? f.link?.ref ?? folderName(f.folder)).join(", ")}`;
}
