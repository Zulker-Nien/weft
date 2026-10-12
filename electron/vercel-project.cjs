// The pieces electron/vercel.cjs builds on: how Vercel's API answers read (deployments, GitHub links,
// domains), the folder's side of a link (.vercel/project.json, .gitignore, package.json), and its GitHub repo.
const fs = require("node:fs");
const path = require("node:path");
const { parseRemote } = require("./vault.cjs");

const API = "https://api.vercel.com";

class VercelError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// One API request: the URL (teamId and query in it) and fetch's options, JSON body and all.
/** @param {string} pathname @param {{ auth: string, teamId?: string, query?: Record<string, unknown>, method?: string, body?: unknown }} options */
function request(pathname, { auth, teamId, query = {}, method = "GET", body }) {
  const url = new URL(pathname, API);
  if (teamId) url.searchParams.set("teamId", teamId);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const headers = { Authorization: `Bearer ${auth}` };
  if (body) headers["Content-Type"] = "application/json";
  return { url, init: { method, headers, body: body ? JSON.stringify(body) : undefined } };
}

// A deployment as the drawer shows it.
function deploymentOf(d) {
  if (!d) return null;
  return { state: d.readyState ?? d.state ?? "UNKNOWN", url: d.url ? `https://${d.url}` : null, createdAt: d.createdAt ?? d.created ?? 0, target: d.target ?? null, page: d.inspectorUrl ?? null };
}

// The GitHub repo a project deploys from, as owner/name, or null.
function gitOf(project) {
  const link = project.link;
  if (!link || link.type !== "github") return null;
  return link.org && link.repo ? `${link.org}/${link.repo}` : (link.repo ?? null);
}

// The production domain: the first alias, else the newest production deployment's url.
function productionUrl(project) {
  const target = project.targets?.production;
  const host = target?.alias?.[0] ?? project.alias?.[0]?.domain ?? target?.url;
  return host ? `https://${host}` : null;
}

// What the picker lists for one project.
function projectRow(p, scope) {
  return { id: p.id, name: p.name, orgId: p.accountId, team: scope.name, teamSlug: scope.slug, git: gitOf(p), framework: p.framework ?? null, updatedAt: p.updatedAt ?? 0 };
}

// The link in a folder's .vercel/project.json, or null.
function readLink(folder) {
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(folder, ".vercel", "project.json"), "utf8"));
    return typeof saved.projectId === "string" && typeof saved.orgId === "string" ? saved : null;
  } catch {
    return null;
  }
}

function mustBeFolder(folder) {
  if (!fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${folder} isn't a folder.`);
}

// Keeps .vercel out of git, as `vercel link` does.
function ignoreVercel(folder) {
  const file = path.join(folder, ".gitignore");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (/^\/?\.vercel\/?$/m.test(text)) return;
  fs.writeFileSync(file, `${text}${text && !text.endsWith("\n") ? "\n" : ""}.vercel\n`);
}

// .vercel/project.json, as `vercel link` writes it, and .vercel kept out of git.
function writeLink(folder, projectId, orgId, projectName) {
  fs.mkdirSync(path.join(folder, ".vercel"), { recursive: true });
  fs.writeFileSync(path.join(folder, ".vercel", "project.json"), JSON.stringify({ projectId, orgId, projectName }));
  ignoreVercel(folder);
}

// What Vercel takes as a project name.
const PROJECT_NAME = /^(?!.*---)[a-z0-9._-]{1,100}$/;

// Vercel's framework preset for a folder, from its package.json dependencies; null leaves it to Vercel.
const FRAMEWORKS = [
  ["next", "nextjs"],
  ["@remix-run/react", "remix"],
  ["@sveltejs/kit", "sveltekit"],
  ["nuxt", "nuxtjs"],
  ["astro", "astro"],
  ["gatsby", "gatsby"],
  ["@angular/core", "angular"],
  ["vite", "vite"],
];

function frameworkOf(folder) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(folder, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return FRAMEWORKS.find(([dep]) => dep in deps)?.[1] ?? null;
  } catch {
    return null;
  }
}

function gitRemote(folder) {
  const { execFile } = require("node:child_process");
  return new Promise((resolve) => {
    execFile("git", ["-C", folder, "remote", "get-url", "origin"], { timeout: 5000 }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

// The folder's GitHub repo as owner/name, or null for another host or no remote.
async function repoOf(folder, remote = gitRemote) {
  const url = await remote(folder);
  const parsed = url && parseRemote(url);
  return parsed && parsed.id.startsWith("github:") ? parsed.label : null;
}

module.exports = {
  VercelError,
  request,
  deploymentOf,
  gitOf,
  productionUrl,
  projectRow,
  readLink,
  mustBeFolder,
  ignoreVercel,
  writeLink,
  PROJECT_NAME,
  frameworkOf,
  gitRemote,
  repoOf,
};
