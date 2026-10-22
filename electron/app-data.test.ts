import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  appFolderFromUrl,
  deriveNeeds,
  effectiveGrant,
  findSavedApp,
  loadGrants,
  manifestHash,
  readManifest,
  registerAppData,
  saveGrants,
  senderOk,
  type FrameEvent,
  type Grant,
} from "./app-data.cjs";
import { FetchInit, FetchLike, SAMPLE_MANIFEST, frameEvent, makeApp, makeAppData, makeDataDir, makeVault, readLink, writeManifestFixture } from "./app-data-test-helpers";

describe("senderOk", () => {
  it("checks owns + the sender's mainFrame === senderFrame", () => {
    const mainFrame = { url: "file:///a" };
    const wc = { id: "wc", mainFrame };
    const ev = { sender: wc, senderFrame: mainFrame };
    expect(senderOk((s) => s === wc, ev)).toBe(true);
    expect(senderOk(() => false, ev)).toBe(false);
    expect(senderOk((s) => s === wc, { sender: wc, senderFrame: { url: "x" } })).toBe(false);
  });
});

describe("appFolderFromUrl", () => {
  it("refuses non-file URLs and out-of-apps-dir real paths", () => {
    const dataDir = makeDataDir();
    expect(() => appFolderFromUrl(dataDir, "https://x.com/y")).toThrow("Open this app in Weft");
    // A file that exists but lives outside the apps dir: realpath resolves, then isInside fails.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "weft-outside-"));
    const outsideFile = path.join(outside, "index.html");
    fs.writeFileSync(outsideFile, "<html></html>");
    expect(() => appFolderFromUrl(dataDir, `file://${outsideFile}`)).toThrow("Open this app in Weft");
    // A file: URL that doesn't parse (a bare path with a colon that isn't a scheme).
    expect(() => appFolderFromUrl(dataDir, "file:///weird:colon/index.html")).toThrow();
  });

  it("refuses a symlink that points outside the apps dir", () => {
    const dataDir = makeDataDir();
    // A real folder with index.html + weft-app.json, outside the apps dir, so realpathSync
    // succeeds and isInside can do the rejecting.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "weft-outside-"));
    fs.writeFileSync(path.join(outside, "index.html"), "<html></html>");
    fs.writeFileSync(path.join(outside, "weft-app.json"), JSON.stringify({ name: "x", env: "production", reads: {} }));
    const linkPath = path.join(dataDir, "apps", "evil");
    fs.symlinkSync(outside, linkPath);
    expect(() => appFolderFromUrl(dataDir, `file://${linkPath}/index.html`)).toThrow("Open this app in Weft");
  });

  it("refuses when the folder holds no weft-app.json", () => {
    const dataDir = makeDataDir();
    const folder = path.join(dataDir, "apps", "no-manifest");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "index.html"), "<html></html>");
    expect(() => appFolderFromUrl(dataDir, `file://${folder}/index.html`)).toThrow("no weft-app.json");
  });
});

describe("readManifest", () => {
  it("checks every field a manifest is allowed to have", () => {
    const dataDir = makeDataDir();
    const okPath = writeManifestFixture(dataDir, "ok.json", SAMPLE_MANIFEST);
    const m = readManifest(okPath, "/projects/x");
    expect(m).toMatchObject({ name: "📈 Growth", env: "production", folder: "/projects/x" });
    expect(() => readManifest(writeManifestFixture(dataDir, "bad.json", "{not json"), "/")).toThrow("valid JSON");
    expect(() => readManifest(writeManifestFixture(dataDir, "env.json", { name: "x", env: "nope" }), "/")).toThrow("development, preview or production");
    expect(() => readManifest(writeManifestFixture(dataDir, "rn.json", { name: "x", env: "production", reads: { "Bad-Name": { supabase: "fn" } } }), "/")).toThrow(/lowercase/);
    expect(() => readManifest(writeManifestFixture(dataDir, "rfn.json", { name: "x", env: "production", reads: { a: { supabase: "BAD-fn" } } }), "/")).toThrow("Postgres identifier");
    expect(() => readManifest(writeManifestFixture(dataDir, "rargs.json", { name: "x", env: "production", reads: { a: { supabase: "fn", args: [1] } } }), "/")).toThrow("args must be an object");
    expect(() => readManifest(writeManifestFixture(dataDir, "rga.json", { name: "x", env: "production", reads: { a: { ga4: [1] } } }), "/")).toThrow("ga4 must be an object");
    expect(() => readManifest(writeManifestFixture(dataDir, "rnone.json", { name: "x", env: "production", reads: { a: { foo: true } } }), "/")).toThrow('must have a "supabase" or "ga4" key');
  });

  // A weft-app.json is untrusted input (anyone can save an app), and supabaseUrl is the host a read
  // sends SUPABASE_SECRET_KEY to. Refused here at load as well as at read time, matching the hosted
  // route's reducedManifest — the fix that only ever reached one of the two copies of this code.
  it("refuses a supabaseUrl that isn't an https Supabase project URL", () => {
    const dataDir = makeDataDir();
    const load = (extra: Record<string, unknown>) => () =>
      readManifest(writeManifestFixture(dataDir, "u.json", { name: "x", env: "production", ...extra }), "/");
    for (const supabaseUrl of [
      "https://attacker.example",
      "http://abc.supabase.co",
      "https://abc.supabase.co.evil.example",
      "https://abc.supabase.co@attacker.example",
      "https://abc.supabase.co:8443",
      "nonsense",
    ]) {
      expect(load({ supabaseUrl })).toThrow("https Supabase project URL");
    }
    // A real project URL loads. Absent or null means "fall back to the project's linked ref", so
    // neither is judged here — resolveSupabaseUrl builds that host from the link instead.
    expect(load({ supabaseUrl: "https://abc.supabase.co" })).not.toThrow();
    expect(load({})).not.toThrow();
    expect(load({ supabaseUrl: null })).not.toThrow();
  });
});

describe("deriveNeeds + manifestHash + effectiveGrant", () => {
  it("derives needs and hashes reads, and voids the grant on any change", () => {
    const needs = deriveNeeds({ a: { supabase: "fn" }, b: { ga4: {} }, c: { supabase: "fn2" } });
    expect(needs).toEqual(["GA4_PROPERTY_ID", "GA4_SERVICE_ACCOUNT_JSON", "SUPABASE_SECRET_KEY"]);
    const h1 = manifestHash(SAMPLE_MANIFEST);
    const h2 = manifestHash({ ...SAMPLE_MANIFEST, env: "development" });
    const h3 = manifestHash({ ...SAMPLE_MANIFEST, reads: { ...SAMPLE_MANIFEST.reads, signups: { supabase: "growth_signups_by_day" } } });
    expect(h1).not.toBe(h2);
    expect(h1).not.toBe(h3);
    const grant: Grant = { env: "production", folder: "/projects/x", needs, readsHash: h1, grantedAt: "x" };
    expect(effectiveGrant(grant, SAMPLE_MANIFEST, needs)).not.toBeNull();
    expect(effectiveGrant({ ...grant, env: "development" }, SAMPLE_MANIFEST, needs)).toBeNull();
    expect(effectiveGrant({ ...grant, folder: "/projects/y" }, SAMPLE_MANIFEST, needs)).toBeNull();
    expect(effectiveGrant({ ...grant, needs: [] }, SAMPLE_MANIFEST, needs)).toBeNull();
    expect(effectiveGrant({ ...grant, readsHash: "nope" }, SAMPLE_MANIFEST, needs)).toBeNull();
  });

  it("finds a saved app whose url's parent matches the folder, and ignores the rest", () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "alpha", SAMPLE_MANIFEST);
    expect(findSavedApp(dataDir, a.folder)).toMatchObject({ id: "saved-1" });
    fs.writeFileSync(path.join(dataDir, "apps.json"), JSON.stringify({ apps: [{ id: "x", name: "Other", url: "https://example.com/", addedAt: 0 }] }));
    expect(findSavedApp(dataDir, a.folder)).toBeUndefined();
  });
});

describe("loadGrants/saveGrants", () => {
  it("writes mode 0600 and round-trips", () => {
    const dataDir = makeDataDir();
    const grant: Grant = { env: "production", folder: "/p", needs: ["X"], readsHash: "h", grantedAt: "now" };
    saveGrants(dataDir, { "/a": grant });
    const mode = (fs.statSync(path.join(dataDir, "app-grants.json")).mode & 0o777).toString(8);
    expect(mode).toBe("600");
    expect(loadGrants(dataDir)).toEqual({ "/a": grant });
    fs.rmSync(path.join(dataDir, "app-grants.json"), { force: true });
    expect(loadGrants(dataDir)).toEqual({});
    fs.writeFileSync(path.join(dataDir, "app-grants.json"), "{not json");
    expect(loadGrants(dataDir)).toEqual({});
  });
});

describe("createAppData access / requestAccess / revoke", () => {
  it("returns the app's name, project label, env, needs, missing and granted=false at first", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "alpha", SAMPLE_MANIFEST);
    const vault = makeVault({ label: "you/repo", secrets: [{ name: "SUPABASE_SECRET_KEY", environment: "production" }] });
    const ad = makeAppData({ dataDir, vault });
    const out = await ad.access(frameEvent({ url: a.url }));
    expect(out).toEqual({ app: "📈 Growth", project: "you/repo", env: "production", needs: ["SUPABASE_SECRET_KEY"], missing: [], granted: false, saved: true });
  });

  it("granted is true when a grant with matching env/folder/needs/readsHash is on disk", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "alpha", SAMPLE_MANIFEST);
    const vault = makeVault({ label: "you/repo", secrets: [{ name: "SUPABASE_SECRET_KEY", environment: "production" }] });
    const ad = makeAppData({ dataDir, vault });
    const state = await ad.access(frameEvent({ url: a.url }));
    const grant: Grant = { env: "production", folder: "/projects/x", needs: state.needs, readsHash: manifestHash(SAMPLE_MANIFEST), grantedAt: new Date().toISOString() };
    saveGrants(dataDir, { [a.folder]: grant });
    const out = await ad.access(frameEvent({ url: a.url }));
    expect(out.granted).toBe(true);
  });

  it("lists a missing vault value in `missing` and not in `needs`-less", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "alpha", SAMPLE_MANIFEST);
    const vault = makeVault({ label: "you/repo", secrets: [] });
    const ad = makeAppData({ dataDir, vault });
    const out = await ad.access(frameEvent({ url: a.url }));
    expect(out.missing).toEqual(["SUPABASE_SECRET_KEY"]);
  });

  it("requestAccess writes the grant on Touch ID yes", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "alpha", SAMPLE_MANIFEST);
    const confirmYes = vi.fn(() => Promise.resolve(true));
    const yesVault = { ...makeVault({ label: "you/repo" }), confirm: confirmYes };
    const ad = makeAppData({ dataDir, vault: yesVault });
    const out1 = await ad.requestAccess(frameEvent({ url: a.url }));
    expect(confirmYes).toHaveBeenCalledWith(expect.stringContaining("let 📈 Growth read you/repo's production env (SUPABASE_SECRET_KEY)"));
    expect(out1.granted).toBe(true);
    const stored = loadGrants(dataDir);
    expect(stored[a.folder]).toMatchObject({ env: "production", folder: "/projects/x", needs: ["SUPABASE_SECRET_KEY"] });
  });

  it("requestAccess returns granted=false on Touch ID no and does not write a grant", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "alpha", SAMPLE_MANIFEST);
    const confirmNo = vi.fn(() => Promise.resolve(false));
    const noVault = { ...makeVault(), confirm: confirmNo };
    const ad = makeAppData({ dataDir, vault: noVault });
    const out = await ad.requestAccess(frameEvent({ url: a.url }));
    expect(confirmNo).toHaveBeenCalled();
    expect(out.granted).toBe(false);
    expect(loadGrants(dataDir)[a.folder]).toBeUndefined();
  });

  it("revoke drops the grant and returns granted=false", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "alpha", SAMPLE_MANIFEST);
    const vault = makeVault();
    const ad = makeAppData({ dataDir, vault });
    const state = await ad.access(frameEvent({ url: a.url }));
    const grant: Grant = { env: "production", folder: "/projects/x", needs: state.needs, readsHash: manifestHash(SAMPLE_MANIFEST), grantedAt: "x" };
    saveGrants(dataDir, { [a.folder]: grant });
    const out = await ad.revoke(frameEvent({ url: a.url }));
    expect(out.granted).toBe(false);
    expect(loadGrants(dataDir)[a.folder]).toBeUndefined();
  });
});

describe("read flow", () => {
  it("calls the supabase RPC and returns rows", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "alpha", SAMPLE_MANIFEST);
    const vault = makeVault({ values: { SUPABASE_SECRET_KEY: "sk" } });
    const calls: { url: string; init: FetchInit }[] = [];
    const fetch: FetchLike = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify([{ day: "20261018", signups: 3 }])) });
    };
    const ad = makeAppData({ dataDir, vault, fetch });
    const state = await ad.access(frameEvent({ url: a.url }));
    const grant: Grant = { env: "production", folder: "/projects/x", needs: state.needs, readsHash: manifestHash(SAMPLE_MANIFEST), grantedAt: "x" };
    saveGrants(dataDir, { [a.folder]: grant });
    const { rows } = await ad.read(frameEvent({ url: a.url }), "signups", { days: 30 });
    expect(rows).toEqual([{ day: "20261018", signups: 3 }]);
    const call = calls[0];
    expect(call?.url).toContain("/rest/v1/rpc/growth_signups_by_day");
    expect(call?.init.headers.apikey).toBe("sk");
    expect(call?.init.headers.authorization).toBe("Bearer sk");
  });

  it("refuses a read with no grant", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "alpha", SAMPLE_MANIFEST);
    const ad = makeAppData({ dataDir });
    await expect(ad.read(frameEvent({ url: a.url }), "signups", { days: 30 })).rejects.toThrow("Grant production access first.");
  });

  it("voids a grant whose manifest hash changed (a read was added)", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "alpha", SAMPLE_MANIFEST);
    const ad = makeAppData({ dataDir });
    const state = await ad.access(frameEvent({ url: a.url }));
    const grant: Grant = { env: "production", folder: "/projects/x", needs: state.needs, readsHash: "stale", grantedAt: "x" };
    saveGrants(dataDir, { [a.folder]: grant });
    await expect(ad.read(frameEvent({ url: a.url }), "signups", { days: 30 })).rejects.toThrow("Grant production access first.");
  });

  it("refuses a read name not in the manifest and silently drops undeclared args", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "alpha", SAMPLE_MANIFEST);
    const vault = makeVault({ values: { SUPABASE_SECRET_KEY: "sk" } });
    const ad = makeAppData({ dataDir, vault });
    const state = await ad.access(frameEvent({ url: a.url }));
    const grant: Grant = { env: "production", folder: "/projects/x", needs: state.needs, readsHash: manifestHash(SAMPLE_MANIFEST), grantedAt: "x" };
    saveGrants(dataDir, { [a.folder]: grant });
    await expect(ad.read(frameEvent({ url: a.url }), "nope", {})).rejects.toThrow(/isn't in weft-app\.json/);
    const fetch: FetchLike = vi.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("{}") }));
    const ad2 = makeAppData({ dataDir, vault, fetch });
    const { rows } = await ad2.read(frameEvent({ url: a.url }), "overview", { whatever: 1 });
    expect(rows).toEqual({});
    expect(fetch).toHaveBeenCalled();
  });

  it("refuses a read when a vault value is missing", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "alpha", SAMPLE_MANIFEST);
    const vault = makeVault({ values: {} });
    const ad = makeAppData({ dataDir, vault });
    const state = await ad.access(frameEvent({ url: a.url }));
    const grant: Grant = { env: "production", folder: "/projects/x", needs: state.needs, readsHash: manifestHash(SAMPLE_MANIFEST), grantedAt: "x" };
    saveGrants(dataDir, { [a.folder]: grant });
    await expect(ad.read(frameEvent({ url: a.url }), "overview", {})).rejects.toThrow("SUPABASE_SECRET_KEY has no value");
  });

  it("falls back to readLink for the supabaseUrl when the manifest omits it", async () => {
    const dataDir = makeDataDir();
    const m = { ...SAMPLE_MANIFEST, supabaseUrl: null };
    const a = makeApp(dataDir, "alpha", m);
    const vault = makeVault({ values: { SUPABASE_SECRET_KEY: "sk" } });
    const calls: { url: string }[] = [];
    const fetch: FetchLike = (url) => {
      calls.push({ url });
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("{}") });
    };
    const ad = makeAppData({ dataDir, vault, fetch });
    const state = await ad.access(frameEvent({ url: a.url }));
    const grant: Grant = { env: "production", folder: "/projects/x", needs: state.needs, readsHash: manifestHash(m), grantedAt: "x" };
    saveGrants(dataDir, { [a.folder]: grant });
    await ad.read(frameEvent({ url: a.url }), "overview", {});
    expect(readLink).toHaveBeenCalledWith("/projects/x");
    expect(calls[0]?.url).toBe("https://lqjyravglujyizyqypxq.supabase.co/rest/v1/rpc/growth_overview");
  });
});

describe("the IPC layer", () => {
  it("refuses unless owns + mainFrame match, and passes the sender's frame url", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "alpha", SAMPLE_MANIFEST);
    const vault = makeVault();
    const ad = makeAppData({ dataDir, vault });
    const handlers = new Map<string, (event: FrameEvent, ...args: unknown[]) => Promise<unknown>>();
    const ipcMain = { handle: (channel: string, fn: (event: FrameEvent, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, fn) };
    const mainFrame = { url: a.url };
    const wc = { id: "wc", mainFrame };
    registerAppData(ipcMain, { appData: ad, owns: (sender) => sender === wc });

    const other: FrameEvent = { sender: { id: "other", mainFrame }, senderFrame: mainFrame };
    await expect(handlers.get("app-data:access")!(other)).rejects.toThrow("only answers the pane's main frame");
    const out = await handlers.get("app-data:access")!({ sender: wc, senderFrame: mainFrame });
    expect(out).toMatchObject({ app: "📈 Growth" });
    const iframe = { url: a.url };
    await expect(handlers.get("app-data:access")!({ sender: wc, senderFrame: iframe })).rejects.toThrow("only answers the pane's main frame");
  });
});
