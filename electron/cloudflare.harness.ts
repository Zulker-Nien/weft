// The fake api.cloudflare.com and the createCloudflare it drives, shared by electron/cloudflare*.test.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { createCloudflare, LINKS_FILE } from "./cloudflare.cjs";

export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`w:${text}`),
  decryptString: (buf: Buffer) => buf.toString().slice(2),
};

export const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

export type Answer = { status?: number; body: unknown };
export type Init = { method: string; headers: Record<string, string>; body?: string };
type Route = (url: URL, init: Init) => Answer;

// A fake api.cloudflare.com: routes by path (after /client/v4), wraps a plain value as { success, result },
// answers 404 otherwise. Records each URL and its token.
export function fakeFetch(routes: Record<string, unknown>) {
  const calls: { url: URL; auth: string | undefined; method: string; body?: string }[] = [];
  const fetch = vi.fn((url: URL, init: Init) => {
    calls.push({ url, auth: init.headers.Authorization, method: init.method, body: init.body });
    const route = routes[url.pathname.replace("/client/v4", "")];
    const answer: Answer =
      typeof route === "function"
        ? (route as Route)(url, init)
        : route === undefined
          ? { status: 404, body: { success: false, errors: [{ code: 10007, message: "Not found" }] } }
          : { body: { success: true, result: route } };
    const status = answer.status ?? 200;
    return Promise.resolve({ ok: status < 400, status, json: () => (answer.body === "bad json" ? Promise.reject(new Error("x")) : Promise.resolve(answer.body)) });
  });
  return { fetch, calls };
}

export const ACC = "/accounts/acc1";
export const PAGES = {
  name: "site",
  subdomain: "site.pages.dev",
  domains: ["site.pages.dev", "site.example.com"],
  source: { type: "github", config: { owner: "me", repo_name: "site" } },
  latest_deployment: { url: "https://abc.site.pages.dev", created_on: "2026-10-01T00:00:00Z", environment: "production", latest_stage: { name: "deploy", status: "success" } },
};

export const API: Record<string, unknown> = {
  "/accounts": [{ id: "acc1", name: "Acme" }],
  [`${ACC}/pages/projects/site`]: PAGES,
  [`${ACC}/workers/scripts/api/deployments`]: { deployments: [{ id: "d1", created_on: "2026-10-01T00:00:00Z", source: "wrangler" }, { id: "d2", created_on: "2026-10-05T00:00:00Z", source: "dash" }] },
  [`${ACC}/workers/subdomain`]: { subdomain: "acme" },
  [`${ACC}/workers/domains`]: [],
  [`${ACC}/workers/scripts/api/subdomain`]: { enabled: true },
};

export function make(routes: Record<string, unknown> = API, remote = "git@github.com:me/site.git") {
  const dataDir = tmp("weft-data-");
  const { fetch, calls } = fakeFetch(routes);
  const sleep = vi.fn(() => Promise.resolve());
  const cloudflare = createCloudflare({ dataDir, safeStorage, fetch: fetch as unknown as typeof globalThis.fetch, remote: () => Promise.resolve(remote), host: "mac", sleep });
  return { cloudflare, dataDir, calls, sleep };
}

export const ok = (result: unknown): Answer => ({ body: { success: true, result } });
export const GROUPS = [
  { id: "g-acct", name: "Account Settings Read", scopes: ["com.cloudflare.api.account"] },
  { id: "g-zone-workers", name: "Workers Scripts Write", scopes: ["com.cloudflare.api.account.zone"] },
  { id: "g-workers", name: "Workers Scripts Write", scopes: ["com.cloudflare.api.account"] },
  { id: "g-pages", name: "Cloudflare Pages Edit" },
  { id: "g-dns", name: "DNS Write", scopes: ["com.cloudflare.api.account.zone"] },
];

// A setup token ("setup") that makes Weft's token ("narrow", id "n1") and deletes tokens as asked.
// accountsFor(auth, tryNo) answers /accounts.
export function setupApi(accountsFor: (auth: string, tryNo: number) => Answer, deleteOk = true) {
  let tries = 0;
  const deleted: string[] = [];
  const routes: Record<string, unknown> = {
    "/user/tokens/permission_groups": (_u: URL, init: Init) => (init.headers.Authorization === "Bearer setup" ? ok(GROUPS) : { status: 403, body: { success: false, errors: [{ code: 9109, message: "Unauthorized" }] } }),
    "/user/tokens/verify": { id: "s1", status: "active" },
    "/user/tokens": (_u: URL, init: Init) => (init.method === "POST" ? ok({ id: "n1", value: "narrow" }) : { status: 405, body: {} }),
    "/accounts": (_u: URL, init: Init) => accountsFor((init.headers.Authorization ?? "").slice(7), ++tries),
  };
  for (const id of ["s1", "n1"])
    routes[`/user/tokens/${id}`] = (_u: URL, init: Init) => {
      if (init.method !== "DELETE" || !deleteOk) return { status: 403, body: { success: false, errors: [{ message: "No" }] } };
      deleted.push(id);
      return ok({ id });
    };
  return { routes, deleted };
}

export const linkFolder = (dataDir: string, folder: string, link: unknown) => fs.writeFileSync(path.join(dataDir, LINKS_FILE), JSON.stringify({ [folder]: link }));
