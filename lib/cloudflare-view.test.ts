// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  cloudflareActions,
  cloudflareBridge,
  cloudflareTitle,
  deployState,
  deployWhere,
  matchScore,
  needsRestart,
  pickerList,
  shownFolders,
  sourceLine,
  tokenSavedLine,
  unlinkedLine,
  type CloudflareBridge,
  type CloudflareFolder,
  type CloudflareProject,
} from "./cloudflare-view";

const folder = (path: string, over: Partial<CloudflareFolder> = {}): CloudflareFolder => ({ folder: path, repo: null, wrangler: null, link: null, error: null, ...over });
const project = (name: string, over: Partial<CloudflareProject> = {}): CloudflareProject => ({ kind: "worker", name, accountId: "a", account: "Acme", git: null, updatedAt: 0, ...over });
const shell = (value: unknown) => ((window as unknown as { weft?: unknown }).weft = value);

afterEach(() => {
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("cloudflare-view", () => {
  it("says what happened to a setup token after saving", () => {
    expect(tokenSavedLine({ name: "Acme" })).toBe("Signed in to Cloudflare: Acme");
    expect(tokenSavedLine({ name: "Acme", made: true, setupDeleted: true })).toBe("Signed in to Cloudflare: Acme. Weft made its own token and deleted the setup token.");
    expect(tokenSavedLine({ name: "Acme", made: true, setupDeleted: false })).toContain("couldn't delete the setup token");
  });

  it("finds the bridge, and when a restart would turn it on", () => {
    expect(cloudflareBridge()).toBeNull();
    expect(needsRestart(null, null)).toBe(false);
    shell({ desktop: true });
    expect(needsRestart(null, null)).toBe(true);
    const bridge = {} as CloudflareBridge;
    shell({ desktop: true, cloudflare: bridge });
    expect(cloudflareBridge()).toBe(bridge);
    expect(needsRestart(bridge, null)).toBe(false);
    expect(needsRestart(bridge, "offline")).toBe(false);
    expect(needsRestart(bridge, "Error invoking remote method 'cloudflare:status': Error: No handler registered for 'cloudflare:status'")).toBe(true);
  });

  it("scores the wrangler config's name, then the repo, then names", () => {
    const f = folder("/dev/my-site", { repo: "me/web", wrangler: { file: "wrangler.toml", name: "api", kind: "worker" } });
    expect(matchScore(project("api"), f)).toBe(4);
    expect(matchScore(project("x", { git: "ME/web" }), f)).toBe(3);
    expect(matchScore(project("web"), f)).toBe(2);
    expect(matchScore(project("my_site"), f)).toBe(2);
    expect(matchScore(project("site"), f)).toBe(1);
    expect(matchScore(project("other"), f)).toBe(0);
    expect(matchScore(project("---"), folder("/dev/x"))).toBe(0);
  });

  it("lists best fits first, then newest, and searches name, account, kind and repo", () => {
    const list = [project("old", { updatedAt: 1 }), project("new", { updatedAt: 9 }), project("site", { kind: "pages", git: "me/site", account: "Side" })];
    const f = folder("/dev/site");
    expect(pickerList(list, f).map((r) => r.project.name)).toEqual(["site", "new", "old"]);
    expect(pickerList(list, f, "pages").map((r) => r.project.name)).toEqual(["site"]);
    expect(pickerList(list, f, "side").map((r) => r.project.name)).toEqual(["site"]);
    expect(pickerList(list, f, "ME/SITE").map((r) => r.project.name)).toEqual(["site"]);
    expect(pickerList(list, f, " worker ").map((r) => r.project.name)).toEqual(["new", "old"]);
  });

  it("labels deploy states and where they went", () => {
    expect(deployState("success")).toEqual({ label: "Ready", tone: "ok" });
    expect(deployState("failure").tone).toBe("bad");
    expect(deployState("deployed").label).toBe("Deployed");
    expect(deployState("weird")).toEqual({ label: "Weird", tone: "muted" });
    expect(deployWhere({ target: "production", source: "wrangler" })).toBe("via wrangler");
    expect(deployWhere({ target: "production", source: null })).toBe("production");
    expect(deployWhere({ target: "preview", source: null })).toBe("preview");
  });

  it("says where a project deploys from", () => {
    const pages = { kind: "pages" as const, name: "site" };
    expect(sourceLine({ ...pages, git: null }, { repo: "me/site", wrangler: null })).toEqual({ text: "Uploaded directly, not built from Git", warn: false });
    expect(sourceLine({ ...pages, git: "me/other" }, { repo: "me/site", wrangler: null })).toEqual({ text: "Builds from me/other, not me/site", warn: true });
    expect(sourceLine({ ...pages, git: "me/site" }, { repo: null, wrangler: null })).toEqual({ text: "Builds from me/site", warn: false });
    const worker = { kind: "worker" as const, name: "api", git: null };
    expect(sourceLine(worker, { repo: null, wrangler: null })).toBeNull();
    expect(sourceLine(worker, { repo: null, wrangler: { file: "wrangler.toml", name: "web", kind: "worker" } })).toEqual({ text: "wrangler.toml names web, not api", warn: true });
    expect(sourceLine(worker, { repo: null, wrangler: { file: "wrangler.jsonc", name: null, kind: "worker" } })).toEqual({ text: "Deploys with wrangler (wrangler.jsonc)", warn: false });
  });

  it("builds the dashboard shortcuts for each kind", () => {
    expect(cloudflareActions({ kind: "pages" })).toEqual([]);
    expect(cloudflareActions({ kind: "pages", dashboard: "https://d/p" }).map((a) => a.url)).toEqual(["https://d/p/domains", "https://d/p"]);
    expect(cloudflareActions({ kind: "worker", dashboard: "https://d/w" }).map((a) => a.label)).toEqual(["Deploys", "Logs", "Settings", "Dashboard"]);
  });

  it("describes an unlinked folder, filters to the project, and titles the rail icon", () => {
    expect(unlinkedLine({ repo: "me/x", wrangler: { file: "wrangler.toml", name: "api", kind: "worker" } })).toBe("wrangler.toml names api");
    expect(unlinkedLine({ repo: "me/x", wrangler: null })).toBe("me/x · not on Cloudflare yet");
    expect(unlinkedLine({ repo: null, wrangler: { file: "wrangler.toml", name: null, kind: "worker" } })).toBe("Not linked to Cloudflare");
    const linked = folder("/dev/a", { link: { kind: "worker", accountId: "x", name: "api" } });
    const all = [linked, folder("/dev/b")];
    expect(shownFolders(all, "/dev/b")).toEqual([all[1]]);
    expect(shownFolders(all, null)).toBe(all);
    expect(cloudflareTitle(null, null)).toBe("Cloudflare: link this project");
    const status = { signedIn: true, user: { name: "Acme" }, error: null, folders: all };
    expect(cloudflareTitle(status, "/dev/b")).toBe("Cloudflare: not linked yet");
    expect(cloudflareTitle(status, null)).toBe("Cloudflare: api");
  });
});
