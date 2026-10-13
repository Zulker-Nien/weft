// The control server's vault routes for threads that write (docs/architecture/secrets.md): blank names in
// (mcp__secrets__add_blank) and a value the thread generated into one of them (mcp__secrets__set_value).
// Names and what happened come back, never a value.

// Fills one blank with a value a thread made (a signing secret). Only a blank takes one, so a thread can't
// replace a value the user put in; that stays a hand edit in 🔐. Touch ID every time through vault.confirm,
// never a thread's fill unlock: this is a write.
async function fillBlank(vault, folder, name, environment, value) {
  if (!value) throw new Error(`Give a value for ${name}.`);
  const { label, secrets } = await vault.names(folder);
  const entry = secrets.find((s) => s.name === name && s.environment === environment);
  if (!entry) return { missing: true, label };
  if (!entry.missing) return { filled: true, label };
  if (!(await vault.confirm(`let a thread set ${name} (${label}, ${environment})`))) return { denied: true, label };
  await vault.setValue(folder, name, environment, value, { source: "a thread" });
  return { ok: true, label };
}

function vaultRoutes(getVault) {
  const vault = () => {
    const v = getVault();
    if (!v) throw new Error("The secrets vault isn't ready yet.");
    return v;
  };
  const env = (environment) => String(environment || "development");
  return {
    // Names with no value yet, for the user to fill in later (lib/secret-ask.ts). The rail's 🔐 count goes up; nothing opens.
    "POST /secrets/add-blank": ({ folder, names, environment, hint }) =>
      vault().addBlanks(String(folder), Array.isArray(names) ? names.map(String) : [], [env(environment)], { source: "a thread", hint: hint ? String(hint).slice(0, 200) : undefined }),
    "POST /secrets/set": ({ folder, name, value, environment }) => fillBlank(vault(), String(folder), String(name), env(environment), String(value ?? "")),
  };
}

module.exports = { vaultRoutes, fillBlank };
