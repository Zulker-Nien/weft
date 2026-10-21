// Commands the user said may always run with certain vault secrets ("Always allow" in the approval;
// docs/architecture/secrets.md), remembered per vault. A rule covers one exact command in one folder, the
// names it was approved with (or fewer), one environment, and the package.json script it ran then: if a thread
// edits that script, the rule no longer matches and the user is asked again.
// The file is sealed with safeStorage, so a thread can't write itself a rule; deleting it only forgets them.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const hash = (text) => crypto.createHash("sha256").update(String(text ?? "")).digest("hex");

/** The parts of a request a rule pins down. */
function ruleOf({ id, environment, cwd, command, script, kind = "run" }) {
  return { id, environment, cwd, command, script: hash(script), kind };
}

function sameRule(a, b) {
  return a.id === b.id && a.environment === b.environment && a.cwd === b.cwd && a.command === b.command && a.script === b.script && a.kind === b.kind && a.tree === b.tree;
}

// The state of the code a command runs: HEAD, the diff against it and every untracked file's bytes. A "run" rule holds
// only while this is unchanged, since the script line can stay the same while a thread edits the files it runs
// (pentest 2026-10-20, P-3). null (not a repo, git failed, too much untracked to hash) means: always ask.
const MAX_UNTRACKED = 2000;
function treeFingerprint(cwd) {
  try {
    const git = (args) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"], timeout: 5000, maxBuffer: 64 * 1024 * 1024 });
    const sum = crypto.createHash("sha256").update(git(["rev-parse", "HEAD"])).update(git(["diff", "HEAD", "--binary"]));
    const untracked = git(["ls-files", "-o", "--exclude-standard", "-z"]).toString().split("\0").filter(Boolean);
    if (untracked.length > MAX_UNTRACKED) return null;
    const root = git(["rev-parse", "--show-toplevel"]).toString().trim();
    for (const name of untracked.sort()) {
      sum.update(`\0${name}\0`);
      try {
        sum.update(fs.readFileSync(path.join(root, name)));
      } catch {}
    }
    return sum.digest("hex");
  } catch {
    return null;
  }
}

function createRunRules({ file, safeStorage, treeOf = treeFingerprint }) {
  const sealed = Boolean(safeStorage?.isEncryptionAvailable?.());
  let rules = null;

  function load() {
    if (rules) return rules;
    rules = [];
    if (!sealed || !fs.existsSync(file)) return rules;
    try {
      rules = JSON.parse(safeStorage.decryptString(Buffer.from(fs.readFileSync(file, "utf8"), "base64")));
    } catch {
      rules = [];
    }
    return rules;
  }

  function save() {
    // Without safeStorage the rules last until Weft quits: a plain file is one a thread could write.
    if (!sealed) return;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(rules)).toString("base64"), { mode: 0o600 });
  }

  // A "run" rule carries the tree it was approved on; a dev grant keeps working while you edit (the dev server restarts).
  function wanted(request) {
    const rule = ruleOf(request);
    return rule.kind === "run" ? { ...rule, tree: treeOf(request.cwd) } : rule;
  }

  return {
    /** Whether a remembered rule covers this request and every name it wants. */
    allows(request, names) {
      const want = wanted(request);
      if (want.tree === null) return false;
      return load().some((r) => sameRule(r, want) && names.every((n) => r.names.includes(n)));
    },
    remember(request, names) {
      const want = wanted(request);
      if (want.tree === null) return;
      const found = load().find((r) => sameRule(r, want));
      if (found) found.names = [...new Set([...found.names, ...names])].sort();
      else {
        // The same command approved on an older tree: that approval is spent, this one replaces it.
        rules = rules.filter((r) => !sameRule({ ...r, tree: want.tree }, want));
        rules.push({ ...want, names: [...names].sort() });
      }
      save();
    },
    list: () => load().map(({ id, environment, cwd, command, kind, names }) => ({ id, environment, cwd, command, kind, names })),
    forget(id) {
      rules = load().filter((r) => r.id !== id);
      save();
    },
  };
}

module.exports = { createRunRules, ruleOf, treeFingerprint };
