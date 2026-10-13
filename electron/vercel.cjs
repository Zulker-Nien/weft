// Vercel's side of Electron main (docs/architecture/vercel.md): your Vercel token, sealed by safeStorage
// (the Keychain) so threads never see it, the projects it can reach, and which one a folder is linked to.
// A link is `.vercel/project.json`, the same file `vercel link` writes, so the Vercel CLI in a thread
// deploys and reads logs for the right project without asking. Like the vault, it answers the board only.
const fs = require("node:fs");
const path = require("node:path");
const { VercelError, deploymentOf, frameworkOf, gitOf, gitRemote, mustBeFolder, productionUrl, projectRow, PROJECT_NAME, readLink, repoOf, request, writeLink } = require("./vercel-project.cjs");

const TOKEN_FILE = "vercel-token.json";
// The most projects one scope (your account or a team) lists; enough to pick from by name.
const PAGE = 100;

function createVercel({ dataDir, safeStorage, fetch: fetchImpl = globalThis.fetch, remote = gitRemote }) {
  const tokenFile = path.join(dataDir, TOKEN_FILE);
  let teams = null; // [{ id, name, slug }], cached for the session

  function token() {
    if (!fs.existsSync(tokenFile)) return null;
    const saved = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
    return safeStorage.decryptString(Buffer.from(saved.token, "base64"));
  }

  async function call(pathname, { auth = token(), ...options } = {}) {
    if (!auth) throw new VercelError(401, "Add a Vercel token first.");
    const { url, init } = request(pathname, { auth, ...options });
    const res = await fetchImpl(url, init);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) throw new VercelError(res.status, "Vercel turned the token down. Add a new one.");
    if (!res.ok) throw new VercelError(res.status, data?.error?.message ?? `Vercel answered ${res.status}.`);
    return data;
  }

  // Your account first (an older personal account has projects outside any team), then every team.
  async function scopes() {
    if (!teams) {
      const { teams: list = [] } = await call("/v2/teams", { query: { limit: PAGE } });
      teams = list.map((t) => ({ id: t.id, name: t.name ?? t.slug, slug: t.slug }));
    }
    return teams;
  }

  // An org id is a team (team_…) or your own account; only a team goes in the query.
  const teamOf = (orgId) => (orgId.startsWith("team_") ? orgId : undefined);

  // slug: your username, the dashboard's path for a project outside any team.
  async function linkedStatus(link, slug) {
    const teamId = teamOf(link.orgId);
    const project = await call(`/v9/projects/${encodeURIComponent(link.projectId)}`, { teamId });
    const { deployments = [] } = await call("/v6/deployments", { teamId, query: { projectId: link.projectId, limit: 1 } });
    const team = teamId ? (await scopes()).find((t) => t.id === teamId) : null;
    return {
      projectId: project.id,
      orgId: link.orgId,
      name: project.name,
      team: team?.name ?? null,
      git: gitOf(project),
      url: productionUrl(project),
      dashboard: team || slug ? `https://vercel.com/${team?.slug ?? slug}/${project.name}` : `https://vercel.com/dashboard`,
      latest: deploymentOf(deployments[0]),
    };
  }

  return {
    // Whether a token is saved and who it is, and each folder's GitHub repo and link. A folder whose
    // project can't be read keeps its link with an error, so you can still unlink it.
    /** @returns {Promise<import("../lib/vercel-view").VercelStatus>} */
    async status(folders) {
      const signedIn = fs.existsSync(tokenFile);
      let user = null;
      let error = null;
      let slug = null;
      if (signedIn) {
        try {
          const data = await call("/v2/user");
          user = { username: data.user?.username ?? data.user?.email ?? "you" };
          slug = data.user?.username ?? null;
        } catch (err) {
          error = err.message;
        }
      }
      const rows = await Promise.all(
        folders.map(async (folder) => {
          const link = readLink(folder);
          const row = { folder, repo: await repoOf(folder, remote), link: null, error: null };
          if (!link) return row;
          row.link = { projectId: link.projectId, orgId: link.orgId, name: link.projectName ?? null };
          if (!user) return row;
          try {
            row.link = await linkedStatus(link, slug);
          } catch (err) {
            row.error = err.message;
          }
          return row;
        }),
      );
      return { signedIn, user, error, folders: rows };
    },

    // Checks the token with Vercel before keeping it.
    async setToken(value) {
      const auth = String(value ?? "").trim();
      if (!auth) throw new Error("Paste a token from vercel.com/account/tokens.");
      if (!safeStorage.isEncryptionAvailable()) throw new Error("The Keychain isn't available, so Weft can't keep the token safely.");
      const data = await call("/v2/user", { auth });
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(tokenFile, JSON.stringify({ token: safeStorage.encryptString(auth).toString("base64"), savedAt: new Date().toISOString() }), { mode: 0o600 });
      teams = null;
      return { username: data.user?.username ?? data.user?.email ?? "you" };
    },

    forgetToken() {
      fs.rmSync(tokenFile, { force: true });
      teams = null;
      return { signedIn: false };
    },

    // Every project the token reaches, newest first. A scope that fails (a team the token isn't scoped
    // to) is left out, unless they all fail.
    /** @returns {Promise<import("../lib/vercel-view").VercelProject[]>} */
    async projects() {
      const lists = await Promise.allSettled(
        [{ id: undefined, name: "Personal", slug: null }, ...(await scopes())].map(async (scope) => {
          const { projects = [] } = await call("/v10/projects", { teamId: scope.id, query: { limit: PAGE } });
          return projects.map((p) => projectRow(p, scope));
        }),
      );
      const failed = lists.find((l) => l.status === "rejected");
      if (failed && lists.every((l) => l.status === "rejected")) throw failed.reason;
      const seen = new Map();
      for (const p of lists.flatMap((l) => (l.status === "fulfilled" ? l.value : []))) if (!seen.has(p.id)) seen.set(p.id, p);
      return [...seen.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    },

    // Where a new project can go: your teams, and your own account when it has no default team (newer
    // accounts keep everything in a team). defaultTeamId is picked first.
    /** @returns {Promise<import("../lib/vercel-view").VercelScopes>} */
    async scopes() {
      const { user = {} } = await call("/v2/user");
      const list = (await scopes()).map((t) => ({ id: t.id, name: t.name }));
      const personal = user.defaultTeamId ? [] : [{ id: null, name: "Personal" }];
      return { scopes: [...personal, ...list], defaultId: user.defaultTeamId ?? null };
    },

    // Writes .vercel/project.json for the folder, after checking the project is really there.
    async link(folder, projectId, orgId) {
      mustBeFolder(folder);
      const project = await call(`/v9/projects/${encodeURIComponent(projectId)}`, { teamId: teamOf(orgId) });
      writeLink(folder, project.id, orgId, project.name);
      return { linked: true, name: project.name };
    },

    // Makes a new Vercel project for the folder (framework from its package.json) and links it. With git,
    // it then connects the folder's GitHub repo so pushes deploy; the project stays if that part fails
    // (usually the Vercel GitHub app can't see the repo), and gitError says why.
    async create(folder, { name, teamId, git: connect }) {
      mustBeFolder(folder);
      const clean = String(name ?? "").trim().toLowerCase();
      if (!PROJECT_NAME.test(clean)) throw new Error("A Vercel project name is up to 100 lowercase letters, digits, '.', '_' and '-'.");
      const team = teamId || undefined;
      const project = await call("/v11/projects", { method: "POST", teamId: team, body: { name: clean, framework: frameworkOf(folder) } });
      writeLink(folder, project.id, project.accountId ?? teamId ?? "", project.name);
      const repo = connect ? await repoOf(folder, remote) : null;
      let gitError = null;
      if (repo) {
        try {
          await call(`/v9/projects/${encodeURIComponent(project.id)}/link`, { method: "POST", teamId: team, body: { type: "github", repo } });
        } catch (err) {
          gitError = err.message;
        }
      }
      return { created: true, name: project.name, git: repo && !gitError ? repo : null, gitError };
    },

    unlink(folder) {
      fs.rmSync(path.join(folder, ".vercel", "project.json"), { force: true });
      return { linked: false };
    },

    // The linked project's environment variables: names and where each goes, never values (no decrypt).
    async envList(folder) {
      const link = readLink(folder);
      if (!link) throw new Error(`${path.basename(folder)} isn't linked to a Vercel project yet.`);
      const { envs = [] } = await call(`/v10/projects/${encodeURIComponent(link.projectId)}/env`, { teamId: teamOf(link.orgId) });
      return { project: link.projectName ?? link.projectId, envs: envs.map((e) => ({ key: e.key, targets: Array.isArray(e.target) ? e.target : [e.target].filter(Boolean), type: e.type ?? null })) };
    },

    // Adds or replaces one variable for one environment. Production and Preview values go in as sensitive
    // (nobody reads them back from Vercel's dashboard); Development can't be sensitive, so it's encrypted.
    async envSet(folder, key, environment, value) {
      const link = readLink(folder);
      if (!link) throw new Error(`${path.basename(folder)} isn't linked to a Vercel project yet.`);
      const type = environment === "development" ? "encrypted" : "sensitive";
      await call(`/v10/projects/${encodeURIComponent(link.projectId)}/env`, { method: "POST", teamId: teamOf(link.orgId), query: { upsert: "true" }, body: { key, value, type, target: [environment] } });
      return { pushed: true, project: link.projectName ?? link.projectId };
    },
  };
}

// The IPC handlers. isBoard(sender) says whether a message came from the board window.
function registerVercel(ipcMain, { vercel, env, isBoard }) {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isBoard(event.sender)) throw new Error("Vercel only answers the board window.");
      return fn(...args);
    });
  handle("vercel:status", (folders) => vercel.status(Array.isArray(folders) ? folders.filter((f) => typeof f === "string") : []));
  handle("vercel:set-token", (value) => vercel.setToken(String(value ?? "")));
  handle("vercel:forget-token", () => vercel.forgetToken());
  handle("vercel:projects", () => vercel.projects());
  handle("vercel:scopes", () => vercel.scopes());
  handle("vercel:link", (folder, projectId, orgId) => vercel.link(String(folder), String(projectId), String(orgId)));
  handle("vercel:create", (folder, options) => {
    const o = options && typeof options === "object" ? options : {};
    return vercel.create(String(folder), { name: String(o.name ?? ""), teamId: typeof o.teamId === "string" ? o.teamId : null, git: o.git === true });
  });
  handle("vercel:unlink", (folder) => vercel.unlink(String(folder)));
  if (env) {
    handle("vercel:env-status", (folder) => env.status(String(folder)));
    handle("vercel:env-push", (folder, name, environment) => env.push(String(folder), String(name), String(environment)));
  }
}

// Wires Vercel into Electron main for the board window (board() is its webContents). With the vault, it also
// pushes vault values to the linked project (electron/vercel-env.cjs); env is what threads reach it through.
function setupVercel({ ipcMain, dataDir, board, vault }) {
  const { safeStorage } = require("electron");
  const vercel = createVercel({ dataDir, safeStorage });
  const env = vault ? require("./vercel-env.cjs").createVercelEnv({ vercel, vault }) : null;
  registerVercel(ipcMain, { vercel, env, isBoard: (sender) => Boolean(sender) && sender === board() });
  return { vercel, env };
}

module.exports = { setupVercel, createVercel, registerVercel, TOKEN_FILE };
