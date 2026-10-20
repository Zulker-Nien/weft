// The "Upload secrets" button on the Share dialog (electron/app-secrets-push.cjs). Tests cover
// the account-token parser, the manifest-name list (author + public, deduped), the Touch ID
// gate, the POST body (only names the manifest declared, with values the vault had), and the
// IPC layer's "only the board window" check.

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  accessTokenFrom,
  createAppSecretsPush,
  namesToPush,
  pushTargets,
  registerAppSecretsPush,
} from "./app-secrets-push.cjs";
import { parsePolicy } from "./app-fetch-policy.cjs";
import type { Manifest } from "./app-data.cjs";

const MANIFEST: Manifest = {
  name: "📈 Growth",
  folder: "/projects/x",
  env: "production",
  supabaseUrl: null,
  reads: {},
  secrets: {
    STRIPE_KEY: { hosts: ["api.stripe.com"], methods: ["GET"], paths: ["/v1/charges"] },
    OPENAI_KEY: { from: "viewer", hosts: ["api.openai.com"], methods: ["POST"], paths: ["/v1/responses"] },
  },
  public: ["SUPABASE_PUBLISHABLE_KEY"],
};

// A temp data dir with apps/<slug>/<name>'s manifest; saves apps.json so findApp resolves the id.
function makeDataDir(): string {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-app-push-"));
  fs.mkdirSync(path.join(dataDir, "apps", "growth"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "apps", "growth", "index.html"), "<!doctype html><title>g</title>");
  fs.writeFileSync(path.join(dataDir, "apps", "growth", "weft-app.json"), JSON.stringify(MANIFEST));
  const url = `file://${path.join(dataDir, "apps", "growth", "index.html")}`;
  fs.writeFileSync(path.join(dataDir, "apps.json"), JSON.stringify({
    apps: [{ id: "app-1", name: "📈 Growth", url, share: { id: "share-xyz" }, addedAt: 1 }],
  }));
  return dataDir;
}

// The vault we hand to createAppSecretsPush: valuesFor returns the names it has, missing for
// the rest. Confirm is configurable so a test can decline Touch ID.
function makeVault({ values = {}, confirm = true, label = "you/repo" }: { values?: Record<string, string>; confirm?: boolean; label?: string } = {}) {
  return {
    valuesFor: (_folder: string, names: string[]) => {
      const present = new Set(names.filter((n) => values[n] !== undefined));
      return Promise.resolve({
        label,
        values: Object.fromEntries([...present].map((n) => [n, values[n] as string])),
        missing: names.filter((n) => !present.has(n)),
      });
    },
    confirm: () => Promise.resolve(confirm),
  };
}

function makeResponse({ status = 200, body = "{}" }: { status?: number; body?: string } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(body),
  };
}

describe("accessTokenFrom", () => {
  it("returns the access_token from the weft-auth session", () => {
    expect(accessTokenFrom({ "weft-auth": JSON.stringify({ access_token: "tok-1" }) })).toBe("tok-1");
  });
  it("accepts a pre-parsed session object", () => {
    expect(accessTokenFrom({ "weft-auth": { access_token: "tok-2" } })).toBe("tok-2");
  });
  it("returns null when the session is absent or unparseable", () => {
    expect(accessTokenFrom({})).toBeNull();
    expect(accessTokenFrom({ "weft-auth": "not-json" })).toBeNull();
    expect(accessTokenFrom(null)).toBeNull();
    expect(accessTokenFrom({ "weft-auth": JSON.stringify({ access_token: "" }) })).toBeNull();
  });
});

describe("pushTargets", () => {
  it("names each author secret and its hosts, skipping viewer secrets", () => {
    const policy = parsePolicyFor(MANIFEST);
    const targets = pushTargets(policy);
    expect(targets).toContain("STRIPE_KEY → api.stripe.com");
    expect(targets).not.toContain(expect.stringMatching(/OPENAI_KEY/));
  });
  it("appends the public entries", () => {
    const policy = parsePolicyFor(MANIFEST);
    expect(pushTargets(policy)).toContain("public SUPABASE_PUBLISHABLE_KEY");
  });
});

describe("namesToPush", () => {
  it("returns the author secrets and public names, deduped, in declaration order", () => {
    const policy = parsePolicyFor(MANIFEST);
    expect(namesToPush(policy)).toEqual(["STRIPE_KEY", "SUPABASE_PUBLISHABLE_KEY"]);
  });
  it("skips viewer secrets and undeclared names", () => {
    const policy = parsePolicyFor({ ...MANIFEST, secrets: { OPENAI_KEY: { from: "viewer", hosts: ["api.openai.com"] } }, public: [] });
    expect(namesToPush(policy)).toEqual([]);
  });
});

// Re-runs the same parse app-data-fetch uses, so pushTargets / namesToPush get a real policy.
// parsePolicy takes `unknown` (manifest validation happens in app-data-frame); for the helper
// tests we just want the parsed shape.
const parsePolicyFor = (m: Manifest) => parsePolicy(m);

describe("createAppSecretsPush input shape", () => {
  it("throws when any required dependency is missing", () => {
    const good = { dataDir: "/tmp", vault: makeVault(), account: () => ({}), confirm: () => Promise.resolve(true) };
    expect(() => createAppSecretsPush(good)).not.toThrow();
    expect(() => createAppSecretsPush({ ...good, dataDir: "" })).toThrow();
    expect(() => createAppSecretsPush({ ...good, vault: undefined })).toThrow();
    expect(() => createAppSecretsPush({ ...good, confirm: undefined })).toThrow();
    expect(() => createAppSecretsPush({ ...good, account: undefined })).toThrow();
  });
});

describe("push: validation and gate", () => {
  it("refuses a missing or unknown appId without touching fetch", async () => {
    const dataDir = makeDataDir();
    const fetchImpl = vi.fn();
    const handle = createAppSecretsPush({ dataDir, vault: makeVault(), account: () => ({}), confirm: () => Promise.resolve(true), fetch: fetchImpl });
    expect(await handle.push("")).toEqual({ error: "appId is missing." });
    expect(await handle.push("nope")).toEqual({ error: "No such app." });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an app that hasn't been shared", async () => {
    const dataDir = makeDataDir();
    fs.writeFileSync(path.join(dataDir, "apps.json"), JSON.stringify({
      apps: [{ id: "app-1", name: "📈 Growth", url: `file://${path.join(dataDir, "apps", "growth", "index.html")}`, addedAt: 1 }],
    }));
    const fetchImpl = vi.fn();
    const handle = createAppSecretsPush({ dataDir, vault: makeVault(), account: () => ({}), confirm: () => Promise.resolve(true), fetch: fetchImpl });
    expect(await handle.push("app-1")).toEqual({ error: "Share the app first." });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the missing-values error before Touch ID when the vault has no values", async () => {
    const dataDir = makeDataDir();
    const confirm = vi.fn(() => Promise.resolve(true));
    const fetchImpl = vi.fn();
    const handle = createAppSecretsPush({ dataDir, vault: makeVault({ values: {} }), account: () => ({}), confirm, fetch: fetchImpl });
    const out = (await handle.push("app-1")) as { ok: true; pushed: string[]; missing: string[]; error: string };
    expect(out.ok).toBe(true);
    expect(out.pushed).toEqual([]);
    expect(out.missing).toEqual(["STRIPE_KEY", "SUPABASE_PUBLISHABLE_KEY"]);
    expect(out.error).toMatch(/No values yet/);
    expect(confirm).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("asks Touch ID once for the whole push and declines cleanly when refused", async () => {
    const dataDir = makeDataDir();
    const confirm = vi.fn(() => Promise.resolve(false));
    const fetchImpl = vi.fn();
    const handle = createAppSecretsPush({
      dataDir,
      vault: makeVault({ values: { STRIPE_KEY: "sk", SUPABASE_PUBLISHABLE_KEY: "pub" } }),
      account: () => ({}),
      confirm,
      fetch: fetchImpl,
    });
    expect(await handle.push("app-1")).toEqual({ error: "Touch ID declined." });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("push: POST body and response handling", () => {
  it("sends only names the manifest declared, with values the vault had; lists missing ones", async () => {
    const dataDir = makeDataDir();
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse());
    const accountSession = { "weft-auth": JSON.stringify({ access_token: "tok" }) };
    const handle = createAppSecretsPush({
      dataDir,
      vault: makeVault({ values: { STRIPE_KEY: "sk", SUPABASE_PUBLISHABLE_KEY: "pub" } }),
      account: () => accountSession,
      confirm: () => Promise.resolve(true),
      fetch: fetchImpl,
    });
    const out = await handle.push("app-1");
    expect(out).toEqual({ ok: true, pushed: ["STRIPE_KEY", "SUPABASE_PUBLISHABLE_KEY"], missing: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(call[0]).toBe("https://weft.zip/api/apps/secrets");
    expect(call[1].method).toBe("POST");
    expect(call[1].headers.authorization).toBe("Bearer tok");
    expect(call[1].headers["content-type"]).toBe("application/json");
    const body = JSON.parse(call[1].body) as { shareId: string; values: Record<string, string> };
    expect(body.shareId).toBe("share-xyz");
    expect(body.values).toEqual({ STRIPE_KEY: "sk", SUPABASE_PUBLISHABLE_KEY: "pub" });
    expect(body.values).not.toHaveProperty("OPENAI_KEY");
  });

  it("skips names the vault has no value for and lists them in `missing`", async () => {
    const dataDir = makeDataDir();
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse());
    const handle = createAppSecretsPush({
      dataDir,
      vault: makeVault({ values: { STRIPE_KEY: "sk" } }),
      account: () => ({ "weft-auth": { access_token: "tok" } }),
      confirm: () => Promise.resolve(true),
      fetch: fetchImpl,
    });
    const out = await handle.push("app-1");
    expect(out).toEqual({ ok: true, pushed: ["STRIPE_KEY"], missing: ["SUPABASE_PUBLISHABLE_KEY"] });
    const init = (fetchImpl.mock.calls[0] as [string, { body: string }])[1];
    const body = JSON.parse(init.body) as { values: Record<string, string> };
    expect(body.values).toEqual({ STRIPE_KEY: "sk" });
    expect(body.values).not.toHaveProperty("SUPABASE_PUBLISHABLE_KEY");
  });

  it("returns the signed-in error when there is no account token", async () => {
    const dataDir = makeDataDir();
    const confirm = vi.fn(() => Promise.resolve(true));
    const fetchImpl = vi.fn();
    const handle = createAppSecretsPush({
      dataDir,
      vault: makeVault({ values: { STRIPE_KEY: "sk" } }),
      account: () => ({}),
      confirm,
      fetch: fetchImpl,
    });
    expect(await handle.push("app-1")).toEqual({ error: "Sign in to your Weft account first." });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the network error when the fetch itself throws", async () => {
    const dataDir = makeDataDir();
    const fetchImpl = vi.fn(() => Promise.reject(new Error("ECONNRESET")));
    const handle = createAppSecretsPush({
      dataDir,
      vault: makeVault({ values: { STRIPE_KEY: "sk" } }),
      account: () => ({ "weft-auth": { access_token: "tok" } }),
      confirm: () => Promise.resolve(true),
      fetch: fetchImpl,
    });
    expect(await handle.push("app-1")).toEqual({ error: "Couldn't reach weft.zip: ECONNRESET" });
  });

  it("returns the API error when weft.zip answers non-2xx", async () => {
    const dataDir = makeDataDir();
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse({ status: 400, body: "share mismatch" }));
    const handle = createAppSecretsPush({
      dataDir,
      vault: makeVault({ values: { STRIPE_KEY: "sk" } }),
      account: () => ({ "weft-auth": { access_token: "tok" } }),
      confirm: () => Promise.resolve(true),
      fetch: fetchImpl,
    });
    expect(await handle.push("app-1")).toEqual({ error: "weft.zip answered 400: share mismatch." });
  });

  it("returns ok with empty lists and skips Touch ID when no names are pushable", async () => {
    // A fresh dir whose manifest has only a viewer secret + no public names → namesToPush is empty.
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-app-push-empty-"));
    fs.mkdirSync(path.join(dataDir, "apps", "growth"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "apps", "growth", "index.html"), "<!doctype html><title>g</title>");
    const viewerOnly: Manifest = {
      ...MANIFEST,
      secrets: { OPENAI_KEY: { from: "viewer", hosts: ["api.openai.com"] } },
      public: [],
    };
    fs.writeFileSync(path.join(dataDir, "apps", "growth", "weft-app.json"), JSON.stringify(viewerOnly));
    const url = `file://${path.join(dataDir, "apps", "growth", "index.html")}`;
    fs.writeFileSync(path.join(dataDir, "apps.json"), JSON.stringify({
      apps: [{ id: "app-1", name: "📈 Growth", url, share: { id: "share-xyz" }, addedAt: 1 }],
    }));
    const confirm = vi.fn(() => Promise.resolve(true));
    const fetchImpl = vi.fn();
    const handle = createAppSecretsPush({
      dataDir,
      vault: makeVault({ values: { OPENAI_KEY: "x" } }),
      account: () => ({}),
      confirm,
      fetch: fetchImpl,
    });
    expect(await handle.push("app-1")).toEqual({ ok: true, pushed: [], missing: [] });
    expect(confirm).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a manifest folder outside the apps dir", async () => {
    const dataDir = makeDataDir();
    // Move the manifest + saved app outside dataDir/apps so readAppManifest can refuse it.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "weft-push-out-"));
    fs.writeFileSync(path.join(outside, "weft-app.json"), JSON.stringify(MANIFEST));
    fs.writeFileSync(path.join(outside, "index.html"), "<html></html>");
    fs.writeFileSync(path.join(dataDir, "apps.json"), JSON.stringify({
      apps: [{ id: "app-1", name: "📈 Growth", url: `file://${path.join(outside, "index.html")}`, share: { id: "share-xyz" }, addedAt: 1 }],
    }));
    const fetchImpl = vi.fn();
    const handle = createAppSecretsPush({
      dataDir,
      vault: makeVault({ values: { STRIPE_KEY: "sk" } }),
      account: () => ({ "weft-auth": { access_token: "tok" } }),
      confirm: () => Promise.resolve(true),
      fetch: fetchImpl,
    });
    expect(await handle.push("app-1")).toEqual({ error: "This app's folder is outside Weft's apps directory." });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// The test file's dataDir is built once per makeDataDir() call; the "no names are pushable" test
// rewrites the manifest in a fresh dir, so we isolate that write behind a helper.
describe("the IPC layer", () => {
  it("refuses unless the sender is the board window, then routes to push", async () => {
    const dataDir = makeDataDir();
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
    const ipcMain = { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, fn) };
    const board = { id: "board" };
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse());
    const handle = createAppSecretsPush({
      dataDir,
      vault: makeVault({ values: { STRIPE_KEY: "sk" } }),
      account: () => ({ "weft-auth": { access_token: "tok" } }),
      confirm: () => Promise.resolve(true),
      fetch: fetchImpl,
    });
    registerAppSecretsPush(ipcMain, { push: (appId) => handle.push(appId), isBoard: (sender) => sender === board });

    await expect(handlers.get("apps:push-secrets")!({ sender: { id: "other" } }, "app-1")).rejects.toThrow("only answers the board window");
    const out = await handlers.get("apps:push-secrets")!({ sender: board }, "app-1");
    expect(out).toEqual({ ok: true, pushed: ["STRIPE_KEY"], missing: ["SUPABASE_PUBLISHABLE_KEY"] });
  });
});