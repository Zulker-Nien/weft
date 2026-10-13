// Vault → Vercel env push (docs/architecture/vercel.md): which of a project's 🔐 secrets its linked Vercel project
// has, by name and environment, and pushing one across. The value goes from the vault to Vercel's API inside main
// (vault.sendValue, after a Touch ID that names the secret and the project); the board and threads only ever see
// names. The drawer's Push button and mcp__secrets__push_to_vercel both land here.

const ENVIRONMENTS = ["development", "preview", "production"];
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function createVercelEnv({ vercel, vault }) {
  return {
    // One row per vault name and environment: whether it has a value here and whether Vercel has it there.
    // Vercel-only names are listed too, so you can see what the vault doesn't hold.
    /** @returns {Promise<import("../lib/vercel-view").VercelEnvStatus>} */
    async status(folder) {
      const [{ label, secrets }, { project, envs }] = await Promise.all([vault.names(folder), vercel.envList(folder)]);
      const onVercel = new Set(envs.flatMap((e) => e.targets.map((t) => `${t}\n${e.key}`)));
      const rows = secrets.map((s) => ({ name: s.name, environment: s.environment, inVault: !s.missing, onVercel: onVercel.has(`${s.environment}\n${s.name}`) }));
      const known = new Set(secrets.map((s) => `${s.environment}\n${s.name}`));
      for (const e of envs) for (const t of e.targets) if (ENVIRONMENTS.includes(t) && !known.has(`${t}\n${e.key}`)) rows.push({ name: e.key, environment: t, inVault: false, onVercel: true });
      rows.sort((a, b) => ENVIRONMENTS.indexOf(a.environment) - ENVIRONMENTS.indexOf(b.environment) || a.name.localeCompare(b.name));
      return { label, project, rows };
    },

    // Pushes one vault value to the linked project, replacing what Vercel had for that name and environment.
    async push(folder, name, environment) {
      if (!NAME.test(name)) throw new Error(`${name || "A blank name"} isn't a variable name.`);
      if (!ENVIRONMENTS.includes(environment)) throw new Error(`Unknown environment: ${environment}`);
      const { project } = await vercel.envList(folder);
      return vault.sendValue(folder, name, environment, (label) => `push ${name} (${label}, ${environment}) to Vercel project ${project}`, (value) => vercel.envSet(folder, name, environment, value));
    },
  };
}

// The control server's routes for threads (mcp__secrets__push_to_vercel): names in, what happened out, never a value.
function envRoutes(env) {
  return {
    "POST /vercel/env-status": ({ folder }) => env().status(String(folder)),
    "POST /vercel/env-push": ({ folder, name, environment }) => env().push(String(folder), String(name), String(environment ?? "")),
  };
}

module.exports = { createVercelEnv, envRoutes, ENVIRONMENTS };
