// Commands the user said may always run with certain vault secrets ("Always allow" in the approval;
// docs/architecture/secrets.md), remembered per vault. A rule covers one exact command in one folder, the
// names it was approved with (or fewer), one environment, and the package.json script it ran then: if a thread
// edits that script, the rule no longer matches and the user is asked again.
// The file is sealed with safeStorage, so a thread can't write itself a rule; deleting it only forgets them.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const hash = (text) => crypto.createHash("sha256").update(String(text ?? "")).digest("hex");

/** The parts of a request a rule pins down. */
function ruleOf({ id, environment, cwd, command, script, kind = "run" }) {
  return { id, environment, cwd, command, script: hash(script), kind };
}

function sameRule(a, b) {
  return a.id === b.id && a.environment === b.environment && a.cwd === b.cwd && a.command === b.command && a.script === b.script && a.kind === b.kind;
}

function createRunRules({ file, safeStorage }) {
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

  return {
    /** Whether a remembered rule covers this request and every name it wants. */
    allows(request, names) {
      const want = ruleOf(request);
      return load().some((r) => sameRule(r, want) && names.every((n) => r.names.includes(n)));
    },
    remember(request, names) {
      const want = ruleOf(request);
      const found = load().find((r) => sameRule(r, want));
      if (found) found.names = [...new Set([...found.names, ...names])].sort();
      else rules.push({ ...want, names: [...names].sort() });
      save();
    },
    list: () => load().map(({ id, environment, cwd, command, kind, names }) => ({ id, environment, cwd, command, kind, names })),
    forget(id) {
      rules = load().filter((r) => r.id !== id);
      save();
    },
  };
}

module.exports = { createRunRules, ruleOf };
