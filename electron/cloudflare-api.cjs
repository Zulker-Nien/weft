// The pieces electron/cloudflare.cjs builds on: requests to Cloudflare's API, how its answers read (Workers,
// Pages projects, deployments), and the folder's side (the Worker or Pages project its wrangler config names).
const fs = require("node:fs");
const path = require("node:path");

const API = "https://api.cloudflare.com/client/v4";

class CloudflareError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Cloudflare's codes for a token that's malformed, unknown or revoked (not one missing a permission).
const BAD_TOKEN = new Set([6003, 6111, 9106, 9109, 1000]);

// One GET: the URL (query in it) and fetch's options.
/** @param {string} pathname @param {{ auth: string, query?: Record<string, unknown> }} options */
function request(pathname, { auth, query = {} }) {
  const url = new URL(API + pathname);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  return { url, init: { method: "GET", headers: { Authorization: `Bearer ${auth}` } } };
}

// What went wrong, from Cloudflare's envelope ({ success, errors: [{ code, message }], result }).
function failureOf(status, data) {
  const first = Array.isArray(data?.errors) ? data.errors[0] : null;
  if (status === 401 || BAD_TOKEN.has(first?.code)) return new CloudflareError(401, "Cloudflare turned the token down. Add a new one.");
  if (status === 403) return new CloudflareError(403, `${first?.message ?? "Not allowed"}: the token may need more permissions.`);
  return new CloudflareError(status, first?.message ?? `Cloudflare answered ${status}.`);
}

const time = (s) => (s ? Date.parse(s) || 0 : 0);

// The GitHub (or GitLab) repo a Pages project builds from, as owner/name, or null.
function pagesGit(p) {
  const c = p?.source?.config;
  return c?.owner && c?.repo_name ? `${c.owner}/${c.repo_name}` : null;
}

// What the picker lists for a Worker script and for a Pages project.
const workerRow = (script, account) => ({ kind: "worker", name: script.id, accountId: account.id, account: account.name, git: null, updatedAt: time(script.modified_on ?? script.created_on) });
const pagesRow = (p, account) => ({ kind: "pages", name: p.name, accountId: account.id, account: account.name, git: pagesGit(p), updatedAt: time(p.latest_deployment?.created_on ?? p.created_on) });

// A Pages deployment as the drawer shows it: its last stage's status (success, failure, active, idle,
// canceled, skipped) and name (queued, build, deploy…).
function pagesDeploy(d) {
  if (!d) return null;
  return { state: d.latest_stage?.status ?? "unknown", stage: d.latest_stage?.name ?? null, url: d.url ?? null, createdAt: time(d.created_on), target: d.environment ?? null, source: null };
}

// A Worker's newest deployment. Cloudflare records one only once it's live, so it reads as deployed.
function workerDeploy(deployments) {
  const d = [...(deployments ?? [])].sort((a, b) => time(b.created_on) - time(a.created_on))[0];
  if (!d) return null;
  return { state: "deployed", stage: null, url: null, createdAt: time(d.created_on), target: "production", source: d.source ?? null };
}

// The address a Pages project serves on: its first custom domain, else its pages.dev name.
function pagesUrl(p) {
  const custom = (p.domains ?? []).find((d) => !d.endsWith(".pages.dev"));
  const host = custom ?? p.subdomain;
  return host ? `https://${host}` : null;
}

// The address a Worker serves on: its first custom domain, else name.<subdomain>.workers.dev when that's on.
/** @param {string} name @param {{ domains: { hostname: string }[] | null, subdomain: string | null, workersDev?: boolean }} where */
function workerUrl(name, { domains, subdomain, workersDev }) {
  const custom = (domains ?? [])[0]?.hostname;
  if (custom) return `https://${custom}`;
  return subdomain && workersDev !== false ? `https://${name}.${subdomain}.workers.dev` : null;
}

const WRANGLER = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"];

// The Worker or Pages project the folder's wrangler config names (the top-level name), and whether it's
// a Pages project (it sets pages_build_output_dir), or null without a config.
function wranglerOf(folder) {
  for (const file of WRANGLER) {
    let text;
    try {
      text = fs.readFileSync(path.join(folder, file), "utf8");
    } catch {
      continue;
    }
    // TOML's top level ends at its first [table]; JSON's name comes before any nested one in practice.
    const top = file.endsWith(".toml") ? text.split(/^\s*\[/m)[0] : text;
    const name = file.endsWith(".toml") ? top.match(/^\s*name\s*=\s*["']([^"']+)["']/m) : top.match(/"name"\s*:\s*"([^"]+)"/);
    return { file, name: name?.[1] ?? null, kind: /pages_build_output_dir/.test(top) ? "pages" : "worker" };
  }
  return null;
}

module.exports = { API, CloudflareError, request, failureOf, pagesGit, workerRow, pagesRow, pagesDeploy, workerDeploy, pagesUrl, workerUrl, wranglerOf };
