import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSupabase, localMigrations, readLink, registerSupabase, TOKEN_FILE, writeLink } from "./supabase.cjs";

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`w:${text}`),
  decryptString: (buf: Buffer) => buf.toString().slice(2),
};

const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const REF = "abcdefghijklmnopqrst";

// A fake api.supabase.com: routes by path, answers 404 otherwise. Records each call.
function fakeFetch(routes: Record<string, unknown>) {
  const calls: { url: URL; auth: string | undefined; method: string; body?: string; type?: string }[] = [];
  const fetch = vi.fn((url: URL, init: { headers: Record<string, string>; method: string; body?: string }) => {
    calls.push({ url, auth: init.headers.Authorization, method: init.method, body: init.body, type: init.headers["Content-Type"] });
    const route = routes[url.pathname] as { status?: number; body: unknown } | undefined;
    const answer = route === undefined ? { status: 404, body: { message: "Not found" } } : route;
    const status = answer.status ?? 200;
    return Promise.resolve({ ok: status < 400, status, json: () => (answer.body === "bad json" ? Promise.reject(new Error("x")) : Promise.resolve(answer.body)) });
  });
  return { fetch, calls };
}

const ok = (body: unknown) => ({ body });
const PROJECT = { id: REF, ref: REF, name: "web", organization_id: "org1", region: "ap-southeast-1", status: "ACTIVE_HEALTHY", created_at: "2026-10-01T00:00:00Z" };
const API: Record<string, unknown> = {
  "/v1/organizations": ok([{ id: "org1", name: "Acme" }]),
  [`/v1/projects/${REF}`]: ok(PROJECT),
  [`/v1/projects/${REF}/database/migrations`]: ok([{ version: "20260101000000", name: "one" }]),
  "/v1/projects": ok([PROJECT, { ...PROJECT, ref: "zzzzzzzzzzzzzzzzzzzz", id: "zzzzzzzzzzzzzzzzzzzz", name: "old", organization_id: "orgX", organization_slug: "x", created_at: "2025-01-01" }]),
  [`/v1/projects/${REF}/restore`]: ok({}),
};

function make(routes = API, remote: string | null = "git@github.com:me/web.git", vault: unknown = null) {
  const dataDir = tmp("weft-data-");
  const { fetch, calls } = fakeFetch(routes);
  const randomBytes = (n: number) => Buffer.alloc(n, 7);
  const supabase = createSupabase({ dataDir, safeStorage, vault: vault as null, randomBytes, fetch: fetch as unknown as typeof globalThis.fetch, remote: () => Promise.resolve(remote) });
  return { supabase, dataDir, calls };
}

function project(migrations: string[] = []) {
  const folder = tmp("weft-proj-");
  if (migrations.length) {
    fs.mkdirSync(path.join(folder, "supabase", "migrations"), { recursive: true });
    for (const m of migrations) fs.writeFileSync(path.join(folder, "supabase", "migrations", m), "");
  }
  return folder;
}

describe("the folder's side", () => {
  it("reads the CLI's project-ref, else .mcp.json's Supabase server, else nothing", () => {
    const folder = project();
    expect(readLink(folder)).toBeNull();
    fs.writeFileSync(path.join(folder, ".mcp.json"), JSON.stringify({ mcpServers: { other: { url: "https://x.com/mcp" }, db: { url: `https://mcp.supabase.com/mcp?project_ref=${REF}&features=docs` } } }));
    expect(readLink(folder)).toEqual({ ref: REF, source: "mcp" });
    fs.writeFileSync(path.join(folder, ".mcp.json"), JSON.stringify({ mcpServers: { db: { url: "https://mcp.supabase.com/mcp?project_ref=BAD" }, cmd: { command: "x" } } }));
    expect(readLink(folder)).toBeNull();
    fs.writeFileSync(path.join(folder, ".mcp.json"), JSON.stringify({}));
    expect(readLink(folder)).toBeNull();
    writeLink(folder, "zzzzzzzzzzzzzzzzzzzz");
    expect(readLink(folder)).toEqual({ ref: "zzzzzzzzzzzzzzzzzzzz", source: "cli" });
    fs.writeFileSync(path.join(folder, "supabase", ".temp", "project-ref"), "nope\n");
    expect(readLink(folder)).toBeNull();
  });

  it("keeps .temp out of git once, adding to a supabase/.gitignore that's there", () => {
    const folder = project();
    fs.mkdirSync(path.join(folder, "supabase"));
    fs.writeFileSync(path.join(folder, "supabase", ".gitignore"), ".branches");
    writeLink(folder, REF);
    writeLink(folder, REF);
    expect(fs.readFileSync(path.join(folder, "supabase", ".gitignore"), "utf8")).toBe(".branches\n.temp\n");
    const fresh = project();
    writeLink(fresh, REF);
    expect(fs.readFileSync(path.join(fresh, "supabase", ".gitignore"), "utf8")).toBe(".temp\n");
    expect(fs.readFileSync(path.join(fresh, "supabase", ".temp", "project-ref"), "utf8")).toBe(REF);
  });

  it("lists migrations by version, oldest first, skipping other files", () => {
    expect(localMigrations(project())).toEqual([]);
    expect(localMigrations(project(["20260201000000_two_things.sql", "20260101000000_one.sql", "notes.md", "seed.sql"]))).toEqual([
      { version: "20260101000000", name: "one" },
      { version: "20260201000000", name: "two_things" },
    ]);
  });
});

describe("createSupabase", () => {
  it("shows folders without asking Supabase before a token is saved", async () => {
    const { supabase, calls } = make();
    const folder = project(["20260101000000_one.sql"]);
    writeLink(folder, REF);
    expect(await supabase.status([folder])).toEqual({
      signedIn: false,
      orgs: null,
      error: null,
      folders: [{ folder, repo: "me/web", migrations: 1, link: { ref: REF, source: "cli", name: null }, error: null }],
    });
    expect(calls).toHaveLength(0);
    await expect(supabase.projects()).rejects.toThrow("Add a Supabase access token first.");
  });

  it("checks a token before sealing it, and forgets it", async () => {
    const { supabase, dataDir, calls } = make();
    await expect(supabase.setToken("  ")).rejects.toThrow("Paste an access token");
    expect(await supabase.setToken(" sbp_1 ")).toEqual({ orgs: ["Acme"] });
    expect(calls[0]?.auth).toBe("Bearer sbp_1");
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, TOKEN_FILE), "utf8")) as { token: string };
    expect(Buffer.from(saved.token, "base64").toString()).toBe("w:sbp_1");
    expect((fs.statSync(path.join(dataDir, TOKEN_FILE)).mode & 0o777).toString(8)).toBe("600");
    expect(supabase.forgetToken()).toEqual({ signedIn: false });
    expect(fs.existsSync(path.join(dataDir, TOKEN_FILE))).toBe(false);
  });

  it("won't keep a token without the Keychain, or one Supabase turns down", async () => {
    const dataDir = tmp("weft-data-");
    const { fetch } = fakeFetch({ "/v1/organizations": { status: 401, body: {} } });
    const opts = { dataDir, fetch: fetch as unknown as typeof globalThis.fetch, remote: () => Promise.resolve(null) };
    await expect(createSupabase({ ...opts, safeStorage: { ...safeStorage, isEncryptionAvailable: () => false } }).setToken("x")).rejects.toThrow("Keychain");
    await expect(createSupabase({ ...opts, safeStorage }).setToken("x")).rejects.toThrow("turned the token down");
    expect(fs.existsSync(path.join(dataDir, TOKEN_FILE))).toBe(false);
  });

  it("reads a linked project, its org, region and unapplied migrations", async () => {
    const { supabase } = make();
    await supabase.setToken("sbp_1");
    const folder = project(["20260101000000_one.sql", "20260301000000_three.sql"]);
    writeLink(folder, REF);
    const plain = project();
    const status = await supabase.status([folder, plain]);
    expect(status).toMatchObject({ signedIn: true, orgs: ["Acme"], error: null });
    expect(status.folders[0]).toEqual({
      folder,
      repo: "me/web",
      migrations: 2,
      error: null,
      link: { ref: REF, name: "web", org: "Acme", region: "ap-southeast-1", status: "ACTIVE_HEALTHY", createdAt: Date.parse("2026-10-01T00:00:00Z"), source: "cli", url: `https://${REF}.supabase.co`, pending: ["three"] },
    });
    expect(status.folders[1]?.link).toBeNull();
  });

  it("leaves pending unknown when the migrations call fails or there are none", async () => {
    const { supabase } = make({ ...API, [`/v1/projects/${REF}/database/migrations`]: { status: 500, body: "bad json" } });
    await supabase.setToken("sbp_1");
    const withMigrations = project(["20260101000000_one.sql"]);
    const without = project();
    writeLink(withMigrations, REF);
    writeLink(without, REF);
    const { folders } = await supabase.status([withMigrations, without]);
    expect(folders.map((f) => f.link?.pending)).toEqual([null, null]);
  });

  it("keeps a link Supabase can't read, with the error, and reports a token that stopped working", async () => {
    const { supabase, dataDir } = make({ ...API, [`/v1/projects/${REF}`]: { status: 404, body: { message: "Project not found" } } });
    await supabase.setToken("sbp_1");
    const folder = project();
    writeLink(folder, REF);
    expect((await supabase.status([folder])).folders[0]).toMatchObject({ link: { ref: REF, source: "cli" }, error: "Project not found" });

    const broken = make({ "/v1/organizations": { status: 500, body: {} } });
    fs.copyFileSync(path.join(dataDir, TOKEN_FILE), path.join(broken.dataDir, TOKEN_FILE));
    expect(await broken.supabase.status([folder])).toMatchObject({ signedIn: true, orgs: null, error: "Supabase answered 500.", folders: [{ link: { ref: REF, name: null } }] });
  });

  it("lists projects newest first, naming orgs it knows", async () => {
    const { supabase } = make({ ...API, "/v1/organizations": ok({ not: "a list" }) });
    await supabase.setToken("sbp_1");
    const list = await supabase.projects();
    expect(list.map((p: { name: string; org: string | null }) => [p.name, p.org])).toEqual([
      ["web", "org1"],
      ["old", "x"],
    ]);
    const odd = make({ ...API, "/v1/projects": ok([{ id: REF, name: "bare" }]), "/v1/organizations": ok([{ slug: "s" }]) });
    await odd.supabase.setToken("sbp_1");
    expect(await odd.supabase.projects()).toEqual([{ ref: REF, name: "bare", org: null, region: null, status: "UNKNOWN", createdAt: 0 }]);
    const none = make({ ...API, "/v1/projects": ok({}) });
    await none.supabase.setToken("sbp_1");
    expect(await none.supabase.projects()).toEqual([]);
  });

  it("links after checking the project, unlinks the CLI's file, and restores a paused project", async () => {
    const { supabase, calls } = make();
    await supabase.setToken("sbp_1");
    const folder = project();
    await expect(supabase.link(folder, "BAD")).rejects.toThrow("isn't a Supabase project ref");
    await expect(supabase.link(path.join(folder, "nope"), REF)).rejects.toThrow("isn't a folder");
    expect(await supabase.link(folder, REF)).toEqual({ linked: true, name: "web" });
    expect(readLink(folder)).toEqual({ ref: REF, source: "cli" });
    expect(supabase.unlink(folder)).toEqual({ linked: false });
    expect(readLink(folder)).toBeNull();
    await expect(supabase.restore("BAD")).rejects.toThrow("isn't a Supabase project ref");
    expect(await supabase.restore(REF)).toEqual({ restoring: true });
    expect(calls.at(-1)).toMatchObject({ method: "POST" });
    expect(calls.at(-1)?.url.pathname).toBe(`/v1/projects/${REF}/restore`);
  });
});

// A fake vault (electron/vault.cjs): the names a folder's vault holds, and what was set.
function fakeVault(names: { name: string; environment: string; missing: boolean }[] = []) {
  return { names: vi.fn(() => Promise.resolve({ label: "me/web", secrets: names })), setValue: vi.fn(() => Promise.resolve({ saved: true })) };
}
const PASSWORD = Buffer.alloc(24, 7).toString("base64url");

describe("making a project", () => {
  const CREATED = { ...API, "/v1/organizations": ok([{ id: "acme", slug: "acme", name: "Acme" }]), "/v1/projects": ok({ id: REF, ref: REF, name: "shop" }) };

  it("lists the organizations it can go in", async () => {
    const { supabase } = make(CREATED);
    await supabase.setToken("sbp_1");
    expect(await supabase.orgs()).toEqual([{ slug: "acme", name: "Acme" }]);
  });

  it("makes it with a password it keeps in the vault, and links the folder", async () => {
    const vault = fakeVault([{ name: "SUPABASE_DB_PASSWORD", environment: "production", missing: false }, { name: "SUPABASE_DB_PASSWORD", environment: "development", missing: true }]);
    const { supabase, calls } = make(CREATED, null, vault);
    await supabase.setToken("sbp_1");
    const folder = project();
    expect(await supabase.create(folder, { name: " shop ", org: "acme", region: "ap-southeast-1" })).toEqual({ ref: REF, name: "shop", secret: "SUPABASE_DB_PASSWORD" });
    const post = calls.at(-1)!;
    expect(post).toMatchObject({ method: "POST", type: "application/json" });
    expect(post.url.pathname).toBe("/v1/projects");
    expect(JSON.parse(post.body!)).toEqual({ name: "shop", organization_slug: "acme", db_pass: PASSWORD, region_selection: { type: "specific", code: "ap-southeast-1" } });
    expect(vault.setValue).toHaveBeenCalledWith(folder, "SUPABASE_DB_PASSWORD", "development", PASSWORD);
    expect(readLink(folder)).toEqual({ ref: REF, source: "cli" });
    expect(calls.filter((c) => c.method === "GET").every((c) => c.body === undefined && c.type === undefined)).toBe(true);
  });

  it("keeps another project's password, naming the new one after its project", async () => {
    const taken = [{ name: "SUPABASE_DB_PASSWORD", environment: "development", missing: false }];
    const vault = fakeVault(taken);
    const { supabase } = make({ ...CREATED, "/v1/projects": ok({ id: REF }) }, null, vault);
    await supabase.setToken("sbp_1");
    expect(await supabase.create(project(), { name: "my shop!", org: "acme", region: "us-east-1" })).toMatchObject({ name: "my shop!", secret: "SUPABASE_DB_PASSWORD_MY_SHOP" });
    expect((await supabase.create(project(), { name: "日本", org: "acme", region: "us-east-1" })).secret).toBe("SUPABASE_DB_PASSWORD_NEW");
  });

  it("refuses a bad request before calling Supabase", async () => {
    const { supabase, calls } = make(CREATED, null, fakeVault());
    const folder = project();
    const good = { name: "shop", org: "acme", region: "us-east-1" };
    await expect(supabase.create(path.join(folder, "nope"), good)).rejects.toThrow("isn't a folder");
    await expect(supabase.create(folder, { ...good, name: "  " })).rejects.toThrow("Name the project.");
    await expect(supabase.create(folder, { ...good, org: "" })).rejects.toThrow("Pick an organization.");
    await expect(supabase.create(folder, { ...good, region: "moon" })).rejects.toThrow("moon isn't a Supabase region.");
    await expect(make(CREATED).supabase.create(folder, good)).rejects.toThrow("vault isn't running");
    expect(calls).toHaveLength(0);
  });

  it("still links a project whose password the vault couldn't keep, and says so", async () => {
    const vault = fakeVault();
    vault.setValue.mockRejectedValueOnce(new Error("locked"));
    const { supabase } = make(CREATED, null, vault);
    await supabase.setToken("sbp_1");
    const folder = project();
    await expect(supabase.create(folder, { name: "shop", org: "acme", region: "us-east-1" })).rejects.toThrow("Made shop on Supabase, but the vault couldn't keep its database password (locked)");
    expect(readLink(folder)).toEqual({ ref: REF, source: "cli" });
    const odd = make({ ...CREATED, "/v1/projects": ok({ id: "short" }) }, null, fakeVault());
    await odd.supabase.setToken("sbp_1");
    const other = project();
    expect((await odd.supabase.create(other, { name: "x", org: "acme", region: "us-east-1" })).ref).toBe("short");
    expect(readLink(other)).toBeNull();
  });
});

describe("registerSupabase", () => {
  it("answers the board window only, cleaning what it's sent", async () => {
    const handlers = new Map<string, (event: { sender: unknown }, ...args: unknown[]) => Promise<unknown>>();
    const ipcMain = { handle: (channel: string, fn: (event: { sender: unknown }, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, fn) };
    const supabase = {
      status: vi.fn(() => "status"),
      setToken: vi.fn(),
      forgetToken: vi.fn(),
      projects: vi.fn(),
      orgs: vi.fn(),
      create: vi.fn(),
      link: vi.fn(),
      unlink: vi.fn(),
      restore: vi.fn(),
    };
    const board = {};
    registerSupabase(ipcMain, { supabase, isBoard: (sender: unknown) => sender === board });
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender: board }, ...args);
    await expect(handlers.get("supabase:status")!({ sender: {} }, [])).rejects.toThrow("only answers the board window");
    expect(await call("supabase:status", ["/a", 3])).toBe("status");
    expect(supabase.status).toHaveBeenCalledWith(["/a"]);
    await call("supabase:status", "nope");
    expect(supabase.status).toHaveBeenLastCalledWith([]);
    await call("supabase:set-token", undefined);
    expect(supabase.setToken).toHaveBeenCalledWith("");
    await call("supabase:forget-token");
    await call("supabase:projects");
    await call("supabase:orgs");
    expect(supabase.orgs).toHaveBeenCalled();
    await call("supabase:create", "/a", { name: "shop", org: "acme", region: "us-east-1" });
    expect(supabase.create).toHaveBeenCalledWith("/a", { name: "shop", org: "acme", region: "us-east-1" });
    await call("supabase:create", "/a", null);
    expect(supabase.create).toHaveBeenLastCalledWith("/a", { name: "", org: "", region: "" });
    await call("supabase:link", "/a", REF);
    expect(supabase.link).toHaveBeenCalledWith("/a", REF);
    await call("supabase:unlink", "/a");
    await call("supabase:restore", REF);
    expect(supabase.restore).toHaveBeenCalledWith(REF);
    expect(supabase.forgetToken).toHaveBeenCalled();
    expect(supabase.projects).toHaveBeenCalled();
    expect(supabase.unlink).toHaveBeenCalledWith("/a");
  });
});
