import { afterEach, describe, expect, it } from "vitest";
import {
  matchScore,
  migrationLine,
  needsRestart,
  pickerList,
  projectState,
  shownFolders,
  signedInLine,
  supabaseActions,
  supabaseBridge,
  supabaseTitle,
  type SupabaseBridge,
  type SupabaseFolder,
  type SupabaseProject,
} from "./supabase-view";

const folder = (path: string, over: Partial<SupabaseFolder> = {}): SupabaseFolder => ({ folder: path, repo: null, migrations: 0, link: null, error: null, ...over });
const proj = (name: string, createdAt = 0, over: Partial<SupabaseProject> = {}): SupabaseProject => ({ ref: name, name, org: "Acme", region: "us-east-1", status: "ACTIVE_HEALTHY", createdAt, ...over });

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("supabase-view", () => {
  it("finds the bridge only in the desktop shell", () => {
    expect(supabaseBridge()).toBeNull();
    (globalThis as { window?: unknown }).window = { threadboard: {} };
    expect(supabaseBridge()).toBeNull();
    const bridge = {} as SupabaseBridge;
    (globalThis as { window?: unknown }).window = { threadboard: { supabase: bridge } };
    expect(supabaseBridge()).toBe(bridge);
  });

  it("asks for a restart when the shell predates Supabase", () => {
    const bridge = {} as SupabaseBridge;
    expect(needsRestart(true, null, null)).toBe(true);
    expect(needsRestart(false, null, null)).toBe(false);
    expect(needsRestart(true, bridge, "Error invoking remote method 'supabase:status': Error: No handler registered for 'supabase:status'")).toBe(true);
    expect(needsRestart(true, bridge, "offline")).toBe(false);
    expect(needsRestart(true, bridge, null)).toBe(false);
  });

  it("scores and sorts projects for a folder", () => {
    const f = { folder: "/dev/My-Site", repo: "me/web" };
    expect(matchScore(proj("web"), f)).toBe(2);
    expect(matchScore(proj("my_site"), f)).toBe(2);
    expect(matchScore(proj("web-staging"), f)).toBe(1);
    expect(matchScore(proj("other"), f)).toBe(0);
    expect(matchScore(proj("--"), f)).toBe(0);
    expect(matchScore(proj("site"), { folder: "/dev/site", repo: null })).toBe(2);
    const list = [proj("other", 9), proj("web-staging", 1), proj("web", 2), proj("new", 10, { org: null })];
    expect(pickerList(list, f).map((r) => r.project.name)).toEqual(["web", "web-staging", "new", "other"]);
    expect(pickerList(list, f, " ACME ").map((r) => r.project.name)).toEqual(["web", "web-staging", "other"]);
    expect(pickerList(list, f, "new").map((r) => r.project.name)).toEqual(["new"]);
  });

  it("labels project states, known or not", () => {
    expect(projectState("ACTIVE_HEALTHY")).toEqual({ label: "Healthy", tone: "ok" });
    expect(projectState("INACTIVE")).toEqual({ label: "Paused", tone: "muted" });
    expect(projectState("SOMETHING_NEW")).toEqual({ label: "Something new", tone: "muted" });
  });

  it("says how the folder's migrations stand", () => {
    expect(migrationLine({ migrations: 0 }, { pending: null })).toBeNull();
    expect(migrationLine({ migrations: 1 }, { pending: null })).toEqual({ text: "1 migration", warn: false });
    expect(migrationLine({ migrations: 2 }, { pending: [] })).toEqual({ text: "2 migrations, all applied", warn: false });
    expect(migrationLine({ migrations: 4 }, { pending: ["a"] })).toEqual({ text: "1 of 4 migrations not applied: a", warn: true });
    expect(migrationLine({ migrations: 4 }, { pending: ["a", "b", "c"] })).toEqual({ text: "3 of 4 migrations not applied: a, b, …", warn: true });
  });

  it("links into the project's dashboard", () => {
    const actions = supabaseActions("ref1");
    expect(actions.map((a) => a.label)).toEqual(["Auth", "Logs", "Keys", "Usage", "Dash"]);
    expect(actions.at(-1)?.url).toBe("https://supabase.com/dashboard/project/ref1");
    expect(actions[3]?.url).toBe("https://supabase.com/dashboard/project/ref1/settings/billing/usage");
  });

  it("shows the top bar's project, or every one", () => {
    const all = [folder("/a"), folder("/b")];
    expect(shownFolders(all, "/b")).toEqual([all[1]]);
    expect(shownFolders(all, null)).toBe(all);
  });

  it("names the orgs the token reaches", () => {
    expect(signedInLine(null)).toBe("Signed in");
    expect(signedInLine([])).toBe("Signed in");
    expect(signedInLine(["Acme", "Me"])).toBe("Signed in · Acme, Me");
    expect(signedInLine(["A", "B", "C", "D"])).toBe("Signed in · A, B +2");
  });

  it("titles the rail icon", () => {
    expect(supabaseTitle(null, null)).toBe("Supabase: link this project");
    const status = { signedIn: true, orgs: [], error: null, folders: [folder("/dev/a"), folder("/dev/b", { link: { ref: "r", source: "cli" as const, name: "bee" } }), folder("/dev/c", { link: { ref: "rc", source: "mcp" as const, name: null } })] };
    expect(supabaseTitle(status, "/dev/a")).toBe("Supabase: not linked yet");
    expect(supabaseTitle(status, null)).toBe("Supabase: bee, rc");
  });
});
