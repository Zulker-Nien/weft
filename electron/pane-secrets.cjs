// Vault values typed into a card's pane page for a thread that never sees them (docs/architecture/secrets.md):
// https pages only, after a Touch ID that names the secret and the site (vault.useFor). The field is masked on
// screen, and read_page gets ‹NAME› wherever the value shows up.

function createPaneSecrets({ secrets, requirePage, typeText }) {
  const typed = new Map(); // card key -> Map(value -> name)

  function vault() {
    const v = secrets?.();
    if (!v) throw new Error("The secrets vault isn't ready yet.");
    return v;
  }

  function redact(key, text) {
    let out = String(text);
    for (const [value, name] of typed.get(key) ?? []) out = out.split(value).join(`‹${name}›`);
    return out;
  }

  async function fill({ key, folder, name, environment = "development", selector }) {
    const v = vault();
    const wc = requirePage(key);
    const url = new URL(wc.getURL());
    if (url.protocol !== "https:") throw new Error(`Secrets only go into https pages, and this one is ${url.protocol}//${url.host}${url.pathname}.`);
    const got = await v.useFor(String(folder), String(name), String(environment), { card: key, site: url.host });
    if (got.denied || got.missing) return got;
    const { found } = await typeText(wc, selector, got.value);
    if (!found) return { found, label: got.label };
    await wc.executeJavaScript(`(() => {
      const el = document.activeElement;
      if (el && el.type !== "password") el.style.webkitTextSecurity = "disc";
    })()`);
    if (!typed.has(key)) typed.set(key, new Map());
    typed.get(key).set(got.value, String(name));
    return { found, label: got.label };
  }

  return {
    redact,
    fill,
    list: (folder) => vault().names(String(folder)),
  };
}

module.exports = { createPaneSecrets };
