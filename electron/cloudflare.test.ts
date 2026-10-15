import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { failureOf, pagesDeploy, pagesUrl, workerDeploy, workerUrl, wranglerOf } from "./cloudflare-api.cjs";
import { createCloudflare, LINKS_FILE, registerCloudflare, TOKEN_FILE } from "./cloudflare.cjs";
import { API, ACC, linkFolder, make, PAGES, safeStorage, tmp } from "./cloudflare.harness";

describe("cloudflare-api", () => {
  it("reads a bad token, a missing permission and other failures", () => {
    expect(failureOf(401, {}).message).toContain("turned the token down");
    expect(failureOf(400, { errors: [{ code: 6003, message: "Invalid request headers" }] }).message).toContain("turned the token down");
    expect(failureOf(403, { errors: [{ code: 10000, message: "Authentication error" }] }).message).toBe("Authentication error: the token may need more permissions.");
    expect(failureOf(403, {}).message).toBe("Not allowed: the token may need more permissions.");
    expect(failureOf(500, null).message).toBe("Cloudflare answered 500.");
  });

  it("reads deployments and addresses", () => {
    expect(pagesDeploy(null)).toBeNull();
    expect(pagesDeploy({})).toEqual({ state: "unknown", stage: null, url: null, createdAt: 0, target: null, source: null });
    expect(workerDeploy([])).toBeNull();
    expect(workerDeploy(undefined)).toBeNull();
    expect(workerDeploy([{ created_on: "bad" }])).toMatchObject({ createdAt: 0, source: null });
    expect(pagesUrl({ subdomain: "x.pages.dev" })).toBe("https://x.pages.dev");
    expect(pagesUrl({})).toBeNull();
    expect(workerUrl("api", { domains: [{ hostname: "api.example.com" }], subdomain: "acme" })).toBe("https://api.example.com");
    expect(workerUrl("api", { domains: null, subdomain: "acme", workersDev: false })).toBeNull();
    expect(workerUrl("api", { domains: null, subdomain: null })).toBeNull();
  });

  it("reads the name in a folder's wrangler config", () => {
    const folder = tmp("weft-proj-");
    expect(wranglerOf(folder)).toBeNull();
    fs.writeFileSync(path.join(folder, "wrangler.toml"), 'name = "api"\nmain = "src/index.ts"\n[env.staging]\nname = "api-staging"\n');
    expect(wranglerOf(folder)).toEqual({ file: "wrangler.toml", name: "api", kind: "worker" });
    fs.writeFileSync(path.join(folder, "wrangler.jsonc"), '{\n  // site\n  "name": "site",\n  "pages_build_output_dir": "./dist"\n}');
    expect(wranglerOf(folder)).toEqual({ file: "wrangler.jsonc", name: "site", kind: "pages" });
    fs.writeFileSync(path.join(folder, "wrangler.jsonc"), "{}");
    expect(wranglerOf(folder)).toEqual({ file: "wrangler.jsonc", name: null, kind: "worker" });
    const toml = tmp("weft-proj-");
    fs.writeFileSync(path.join(toml, "wrangler.toml"), "[vars]\nname = 'nope'\n");
    expect(wranglerOf(toml)?.name).toBeNull();
  });
});

describe("createCloudflare", () => {
  it("shows folders without asking Cloudflare before a token is saved", async () => {
    const { cloudflare, calls } = make();
    const folder = tmp("weft-proj-");
    expect(await cloudflare.status([folder])).toEqual({ signedIn: false, user: null, error: null, folders: [{ folder, repo: "me/site", wrangler: null, link: null, error: null }] });
    expect(calls).toHaveLength(0);
    await expect(cloudflare.projects()).rejects.toThrow("Add a Cloudflare token first.");
  });

  it("checks a token with Cloudflare and keeps it sealed", async () => {
    const { cloudflare, dataDir, calls } = make();
    await expect(cloudflare.setToken("  ")).rejects.toThrow("Paste a token");
    expect(await cloudflare.setToken(" tok ")).toEqual({ name: "Acme" });
    expect(calls[0]?.auth).toBe("Bearer tok");
    expect(calls[0]?.url.pathname).toBe("/client/v4/user/tokens/permission_groups");
    expect(calls[1]?.url.href).toBe("https://api.cloudflare.com/client/v4/accounts?per_page=50");
    const saved = fs.readFileSync(path.join(dataDir, TOKEN_FILE), "utf8");
    expect(saved).not.toContain('tok"');
    expect(fs.statSync(path.join(dataDir, TOKEN_FILE)).mode & 0o777).toBe(0o600);
    expect(cloudflare.forgetToken()).toEqual({ signedIn: false });
    expect(fs.existsSync(path.join(dataDir, TOKEN_FILE))).toBe(false);
  });

  it("names several accounts by the first, and refuses a token that reaches none", async () => {
    const two = make({ "/accounts": [{ id: "a", name: "Acme" }, { id: "b" }] });
    expect(await two.cloudflare.setToken("t")).toEqual({ name: "Acme +1" });
    const none = make({ "/accounts": [] });
    await expect(none.cloudflare.setToken("t")).rejects.toThrow("reaches no Cloudflare account");
    const empty = make({ "/accounts": () => ({ body: { success: true } }) });
    await expect(empty.cloudflare.setToken("t")).rejects.toThrow("reaches no Cloudflare account");
  });

  it("refuses a token Cloudflare turns down, or without the Keychain", async () => {
    const { cloudflare } = make({ "/accounts": () => ({ status: 400, body: { success: false, errors: [{ code: 6111, message: "Invalid format" }] } }) });
    await expect(cloudflare.setToken("bad")).rejects.toThrow("turned the token down");
    const locked = createCloudflare({ dataDir: tmp("weft-data-"), safeStorage: { ...safeStorage, isEncryptionAvailable: () => false } });
    await expect(locked.setToken("t")).rejects.toThrow("Keychain");
  });

  it("reports a saved token that stopped working, keeping each folder's link", async () => {
    let status = 200;
    const { cloudflare, dataDir } = make({ ...API, "/accounts": () => (status === 200 ? { body: { success: true, result: [{ id: "acc1", name: "Acme" }] } } : { status, body: "bad json" }) });
    await cloudflare.setToken("tok");
    status = 401;
    const folder = tmp("weft-proj-");
    linkFolder(dataDir, folder, { kind: "pages", accountId: "acc1", name: "site" });
    const s = await cloudflare.status([folder]);
    expect(s).toMatchObject({ signedIn: true, user: null });
    expect(s.error).toContain("turned the token down");
    expect(s.folders[0]?.link).toEqual({ kind: "pages", accountId: "acc1", name: "site" });
  });

  it("lists Workers and Pages across accounts, newest first, paging through Pages and skipping a list that fails", async () => {
    const { cloudflare, calls } = make({
      "/accounts": [{ id: "acc1", name: "Acme" }, { id: "acc2", name: "Side" }],
      "/accounts/acc1/workers/scripts": [{ id: "api", modified_on: "2026-10-05T00:00:00Z" }, { id: "cron", created_on: "2026-01-01T00:00:00Z" }, { id: "bare" }],
      "/accounts/acc1/pages/projects": (url: URL) =>
        url.searchParams.get("page") === "1"
          ? { body: { success: true, result: [PAGES], result_info: { total_pages: 2 } } }
          : { body: { success: true, result: [{ name: "old", created_on: "2025-01-01T00:00:00Z" }], result_info: { total_pages: 2 } } },
      "/accounts/acc2/workers/scripts": () => ({ body: { success: true } }),
      "/accounts/acc2/pages/projects": () => ({ status: 403, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] } }),
    });
    await cloudflare.setToken("tok");
    const list = await cloudflare.projects();
    expect(list.map((p: { kind: string; name: string }) => `${p.kind}:${p.name}`)).toEqual(["worker:api", "pages:site", "worker:cron", "pages:old", "worker:bare"]);
    expect(list[1]).toEqual({ kind: "pages", name: "site", accountId: "acc1", account: "Acme", git: "me/site", updatedAt: Date.parse("2026-10-01T00:00:00Z") });
    expect(calls.filter((c) => c.url.pathname.endsWith("acc1/pages/projects"))).toHaveLength(2);
  });

  it("pages once when Cloudflare gives no result_info, and fails when every list does", async () => {
    const one = make({ "/accounts": [{ id: "acc1", name: "Acme" }], "/accounts/acc1/workers/scripts": [], "/accounts/acc1/pages/projects": () => ({ body: { success: true } }) });
    await one.cloudflare.setToken("tok");
    expect(await one.cloudflare.projects()).toEqual([]);
    const down = make({ "/accounts": [{ id: "acc1", name: "Acme" }] });
    await down.cloudflare.setToken("tok");
    await expect(down.cloudflare.projects()).rejects.toThrow("Not found");
  });

  it("links a folder to a Pages project, shows it, and unlinks it", async () => {
    const { cloudflare, dataDir } = make();
    await cloudflare.setToken("tok");
    const folder = tmp("weft-proj-");
    expect(await cloudflare.link(folder, "pages", "acc1", "site")).toEqual({ linked: true, name: "site" });
    const s = await cloudflare.status([folder]);
    expect(s).toMatchObject({ signedIn: true, user: { name: "Acme" }, error: null });
    expect(s.folders[0]).toEqual({
      folder,
      repo: "me/site",
      wrangler: null,
      error: null,
      link: {
        kind: "pages",
        accountId: "acc1",
        name: "site",
        account: "Acme",
        git: "me/site",
        url: "https://site.example.com",
        dashboard: "https://dash.cloudflare.com/acc1/pages/view/site",
        latest: { state: "success", stage: "deploy", url: "https://abc.site.pages.dev", createdAt: Date.parse("2026-10-01T00:00:00Z"), target: "production", source: null },
      },
    });
    expect(cloudflare.unlink(folder)).toEqual({ linked: false });
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, LINKS_FILE), "utf8"))).toEqual({});
  });

  it("links a Worker and shows its newest deployment and workers.dev address", async () => {
    const { cloudflare } = make();
    await cloudflare.setToken("tok");
    const folder = tmp("weft-proj-");
    await cloudflare.link(folder, "worker", "acc1", "api");
    const row = (await cloudflare.status([folder])).folders[0];
    expect(row?.link).toEqual({
      kind: "worker",
      accountId: "acc1",
      name: "api",
      account: "Acme",
      git: null,
      url: "https://api.acme.workers.dev",
      dashboard: "https://dash.cloudflare.com/acc1/workers/services/view/api/production",
      latest: { state: "deployed", stage: null, url: null, createdAt: Date.parse("2026-10-05T00:00:00Z"), target: "production", source: "dash" },
    });
  });

  it("shows a Worker whose address lookups fail, from an account the token no longer lists", async () => {
    const { cloudflare, dataDir } = make({
      "/accounts": [{ id: "acc1", name: "Acme" }],
      "/accounts/acc9/workers/scripts/api/deployments": {},
      "/accounts/acc9/workers/subdomain": () => ({ status: 500, body: {} }),
      "/accounts/acc9/workers/domains": () => ({ status: 500, body: {} }),
      "/accounts/acc9/workers/scripts/api/subdomain": () => ({ status: 500, body: {} }),
    });
    await cloudflare.setToken("tok");
    const folder = tmp("weft-proj-");
    linkFolder(dataDir, folder, { kind: "worker", accountId: "acc9", name: "api" });
    expect((await cloudflare.status([folder])).folders[0]?.link).toMatchObject({ account: null, url: null, latest: null });
  });

  it("finds a workers.dev subdomain answer with none set", async () => {
    const { cloudflare, dataDir } = make({ ...API, [`${ACC}/workers/subdomain`]: null, [`${ACC}/workers/scripts/api/subdomain`]: null });
    await cloudflare.setToken("tok");
    const folder = tmp("weft-proj-");
    linkFolder(dataDir, folder, { kind: "worker", accountId: "acc1", name: "api" });
    expect((await cloudflare.status([folder])).folders[0]?.link?.url).toBeNull();
  });

  it("keeps a link Cloudflare can't read, with the error, and refuses a bad link", async () => {
    const { cloudflare, dataDir } = make();
    await cloudflare.setToken("tok");
    await expect(cloudflare.link("/no/such/folder", "pages", "acc1", "site")).rejects.toThrow("isn't a folder");
    const folder = tmp("weft-proj-");
    await expect(cloudflare.link(folder, "zone", "acc1", "site")).rejects.toThrow("Worker or a Pages project");
    await expect(cloudflare.link(folder, "worker", "acc1", "gone")).rejects.toThrow("Not found");
    linkFolder(dataDir, folder, { kind: "pages", accountId: "acc1", name: "gone" });
    const row = (await cloudflare.status([folder])).folders[0];
    expect(row).toMatchObject({ link: { kind: "pages", accountId: "acc1", name: "gone" }, error: "Not found" });
  });

  it("reads a broken links file as no links, and a wrangler config beside the folder's repo", async () => {
    const { cloudflare, dataDir } = make();
    fs.writeFileSync(path.join(dataDir, LINKS_FILE), "{");
    const folder = tmp("weft-proj-");
    fs.writeFileSync(path.join(folder, "wrangler.json"), '{ "name": "api" }');
    expect((await cloudflare.status([folder])).folders[0]).toMatchObject({ link: null, wrangler: { file: "wrangler.json", name: "api", kind: "worker" } });
  });

  it("finds the repo with git for real", async () => {
    const cloudflare = createCloudflare({ dataDir: tmp("weft-data-"), safeStorage });
    const [row] = (await cloudflare.status([os.tmpdir()])).folders;
    expect(row?.repo).toBeNull();
  });
});

describe("registerCloudflare", () => {
  it("answers the board window only and passes arguments through", async () => {
    const handlers = new Map<string, (event: { sender: unknown }, ...args: unknown[]) => unknown>();
    const ipcMain = { handle: (channel: string, fn: (event: { sender: unknown }, ...args: unknown[]) => unknown) => handlers.set(channel, fn) };
    const board = {};
    const cloudflare = { status: vi.fn(), setToken: vi.fn(), forgetToken: vi.fn(), projects: vi.fn(), link: vi.fn(), unlink: vi.fn() };
    registerCloudflare(ipcMain, { cloudflare, isBoard: (s: unknown) => s === board });
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender: board }, ...args);
    await expect(handlers.get("cloudflare:status")!({ sender: {} }, [])).rejects.toThrow("board window");
    await call("cloudflare:status", ["/a", 3]);
    await call("cloudflare:status", "nope");
    await call("cloudflare:set-token", undefined);
    await call("cloudflare:forget-token");
    await call("cloudflare:projects");
    await call("cloudflare:link", "/a", "pages", "acc1", "site");
    await call("cloudflare:unlink", "/a");
    expect(cloudflare.status.mock.calls).toEqual([[["/a"]], [[]]]);
    expect(cloudflare.setToken).toHaveBeenCalledWith("");
    expect(cloudflare.forgetToken).toHaveBeenCalled();
    expect(cloudflare.projects).toHaveBeenCalled();
    expect(cloudflare.link).toHaveBeenCalledWith("/a", "pages", "acc1", "site");
    expect(cloudflare.unlink).toHaveBeenCalledWith("/a");
  });
});
