// Commands that run with vault values in their env, for threads that never see them
// (docs/architecture/secrets.md). lib/secret-run.ts checks and splits the command; here main asks the user
// (the exact command, its package.json script, the names), spawns it with no shell and the values in its
// env only, and hands back its output with every value swapped for ‹NAME›. A dev server gets its values
// through a one-time grant that electron/secret-env.cjs claims. Either way main remembers the values a
// card used, so the runner can redact them from what it stores (redact).
const crypto = require("node:crypto");
const path = require("node:path");
const { redactor } = require("./secret-redact.cjs");

// Output kept while a command runs, and what goes back to the thread.
const KEEP_CHARS = 1_000_000;
const REPLY_CHARS = 20_000;
// After SIGTERM on a timeout, how long before SIGKILL.
const KILL_GRACE_MS = 3000;
// How long a dev server's grant waits to be claimed.
const GRANT_MS = 60_000;
// Weft's own variables don't go to the commands it runs.
const INTERNAL = /^(THREADBOARD_SHELL_|ELECTRON_RUN_AS_NODE$)/;

function baseEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !INTERNAL.test(k)));
}

function describe({ kind, command, cwd, script, names, environment, label }) {
  const message = kind === "dev" ? `Start this card's dev server with ${label}'s ${environment} secrets?` : `A thread wants to run a command with secrets from ${label}.`;
  const detail = [`Command: ${command}`, `In: ${cwd}`, script ? `Runs:\n${script}` : null, `Secrets (${environment}): ${names.join(", ")}`, "The thread won't see the values; they're shown as ‹NAME› in its output."].filter(Boolean).join("\n\n");
  const reason = `run "${command}" with ${names.join(", ")} (${label})`;
  return { message, detail, reason };
}

/**
 * @typedef {{ missing?: string[], denied?: boolean, label?: string, exitCode?: number | null, signal?: string | null,
 *   timedOut?: boolean, output?: string, truncated?: boolean, ms?: number }} RunReply
 * @typedef {{ names: string[], grant?: string, denied?: boolean, label?: string, node?: string, runner?: string }} DevGrant
 */

function createSecretRun({ vault, ask, rules, spawn, env = process.env, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, randomId = () => crypto.randomBytes(32).toString("hex"), killGraceMs = KILL_GRACE_MS, node = process.execPath, runner = path.join(__dirname, "secret-env.cjs") }) {
  const used = new Map(); // card key -> Map(name -> value)
  const grants = new Map(); // grant -> { values, until }

  function remember(key, values) {
    if (!key) return;
    if (!used.has(key)) used.set(key, new Map());
    for (const [name, value] of Object.entries(values)) used.get(key).set(name, value);
  }

  function redact(key, text) {
    const values = used.get(key);
    if (!values) return String(text ?? "");
    return redactor([...values].map(([name, value]) => ({ name, value })))(text);
  }

  // A remembered rule, or the user's yes ("always" adds a rule).
  async function approve(request, names, label) {
    if (rules.allows(request, names)) return true;
    const choice = await ask(describe({ ...request, names, label }));
    if (!choice) return false;
    if (choice === "always") rules.remember(request, names);
    return true;
  }

  function execute({ argv, cwd, env: extra, values, timeoutMs }) {
    return new Promise((resolve) => {
      const started = now();
      let out = "";
      let cut = false;
      let timedOut = false;
      let child;
      const add = (chunk) => {
        out += chunk.toString();
        if (out.length > KEEP_CHARS) {
          out = out.slice(-KEEP_CHARS);
          cut = true;
        }
      };
      const signal = (sig) => {
        try {
          process.kill(-child.pid, sig);
        } catch {
          child.kill(sig);
        }
      };
      let killTimer;
      const timer = setTimer(() => {
        timedOut = true;
        signal("SIGTERM");
        killTimer = setTimer(() => signal("SIGKILL"), killGraceMs);
      }, timeoutMs);
      const finish = (exitCode, sig) => {
        clearTimer(timer);
        clearTimer(killTimer);
        resolve({ exitCode, signal: sig, timedOut, output: out, cut, ms: now() - started });
      };
      try {
        child = spawn(argv[0], argv.slice(1), { cwd, env: { ...baseEnv(env), ...extra, ...values }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      } catch (err) {
        out = err.message;
        finish(null, null);
        return;
      }
      child.stdout.on("data", add);
      child.stderr.on("data", add);
      child.on("error", (err) => {
        add(`${err.message}\n`);
        finish(null, null);
      });
      child.on("close", (code, sig) => finish(code, sig));
    });
  }

  // Redacted first, then cut to the reply's size; a cut start drops its first line, which could hold part of a value.
  function reply(result, entries, label) {
    let output = redactor(entries)(result.output);
    let truncated = result.cut;
    if (output.length > REPLY_CHARS) {
      output = output.slice(-REPLY_CHARS);
      truncated = true;
    }
    if (truncated) output = output.slice(output.indexOf("\n") + 1);
    return { label, exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, output, truncated, ms: result.ms };
  }

  return {
    redact,

    /** @returns {Promise<RunReply>} */
    async run({ key, folder, cwd, command, argv, env: extra = {}, names, environment = "development", script, timeoutMs = 120_000 }) {
      const { id, label, values, missing } = await vault.valuesFor(folder, names, environment);
      if (missing.length) return { missing, label };
      if (!(await approve({ id, environment, cwd, command, script, kind: "run" }, names, label))) return { denied: true, label };
      remember(key, values);
      const result = await execute({ argv, cwd, env: extra, values, timeoutMs });
      return reply(result, Object.entries(values).map(([name, value]) => ({ name, value })), label);
    },

    // A one-time grant of the folder's development values for a dev server's command, or no names when the
    // vault has none (the server starts the plain way).
    /**
     * @param {{ key?: string, folder: string, cwd: string, command: string, script?: string }} request
     * @returns {Promise<DevGrant>}
     */
    async devGrant({ key, folder, cwd, command, script }) {
      const environment = "development";
      const { id, label, values } = await vault.valuesFor(folder, null, environment);
      const names = Object.keys(values);
      if (!names.length) return { names };
      if (!(await approve({ id, environment, cwd, command, script, kind: "dev" }, names, label))) return { denied: true, names, label };
      remember(key, values);
      const grant = randomId();
      grants.set(grant, { values, until: now() + GRANT_MS });
      return { grant, names, label, node, runner };
    },

    // Used once, by electron/secret-env.cjs.
    claim(grant) {
      const found = grants.get(String(grant));
      grants.delete(String(grant));
      if (!found || now() > found.until) throw new Error("That grant was already used or has expired.");
      return { env: found.values };
    },
  };
}

// The approval: a dialog with the command and names, then Touch ID where the Mac has it.
function runApproval({ dialog, systemPreferences, window }) {
  return async ({ message, detail, reason }) => {
    const { response } = await dialog.showMessageBox(window(), { type: "warning", buttons: ["Cancel", "Allow once", "Always allow"], defaultId: 0, cancelId: 0, message, detail });
    if (response === 0) return null;
    if (systemPreferences.canPromptTouchID?.()) {
      try {
        await systemPreferences.promptTouchID(reason);
      } catch {
        return null;
      }
    }
    return response === 2 ? "always" : "once";
  };
}

// The control server's routes for it (electron/browser-pane.cjs). key defaults to the pane's active card.
/**
 * @param {() => ReturnType<typeof createSecretRun> | undefined} get
 * @param {() => string | undefined} [active]
 */
function secretRunRoutes(get, active = () => undefined) {
  const runner = () => {
    const r = get();
    if (!r) throw new Error("The secrets vault isn't ready yet.");
    return r;
  };
  return {
    "POST /secrets/run": (body) => runner().run({ ...body, key: body.key ?? active() }),
    "POST /secrets/dev-grant": (body) => runner().devGrant(body),
    "POST /secrets/claim": (body) => runner().claim(body.grant),
  };
}

// Wires it into Electron main with the vault, the approval dialog and the sealed rules file.
function setupSecretRun({ vault, dataDir, window }) {
  const { dialog, safeStorage, systemPreferences } = require("electron");
  const { spawn } = require("node:child_process");
  const { createRunRules } = require("./run-rules.cjs");
  const rules = createRunRules({ file: path.join(dataDir, "vault", "run-rules.json"), safeStorage });
  return createSecretRun({ vault, rules, spawn, ask: runApproval({ dialog, systemPreferences, window }) });
}

module.exports = { setupSecretRun, createSecretRun, runApproval, secretRunRoutes, describe, baseEnv, REPLY_CHARS, KEEP_CHARS, GRANT_MS, KILL_GRACE_MS };
