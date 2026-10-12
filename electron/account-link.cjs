// weft://account-callback arrives from the OS after the Weft account OAuth flow. Electron main
// parses the link, forwards the query string to /api/account/weft-callback so the code can be
// exchanged against the PKCE verifier kept in the session file. Success is silent (the board's
// useAccount polls while waiting); errors show a small native dialog with the message the
// server rendered.
const ACCOUNT_CALLBACK_HOST = "account-callback";

function isAccountCallback(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === "weft:" && url.hostname === ACCOUNT_CALLBACK_HOST;
  } catch {
    return false;
  }
}

function accountCallbackBody(raw) {
  if (!isAccountCallback(raw)) return null;
  const url = new URL(raw);
  const body = {};
  for (const [key, value] of url.searchParams) {
    if (typeof value === "string") body[key] = value;
  }
  return body;
}

// accountPage() escapes its text as &#NN; (and a few named entities), which a native dialog
// would show literally ("Couldn&#39;t").
function decodeEntities(text) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => named[n]);
}

// Pulls the visible <h1> and <p> out of the rendered error page. The dialog's title already says
// "Couldn't sign in to Weft", so the detail is the <p> alone (the <h1> only when there's no <p>).
async function extractErrorMessage(res) {
  const html = await res.text();
  const text = (tag) => {
    const raw = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(html)?.[1];
    return raw == null ? "" : decodeEntities(raw.replace(/<[^>]+>/g, "")).trim();
  };
  return text("p") || text("h1") || "Sign-in failed";
}

// getServer: the board's server ({ url }) once it's up. showMain / warn: focus and notify the user.
function createAccountLink({ getServer, showMain, warn }) {
  return {
    isAccountCallback,
    handle: (raw) => handleAccountCallback(raw, { getServer, showMain, warn }),
  };
}

async function handleAccountCallback(raw, { getServer, showMain, warn }) {
  showMain();
  const body = accountCallbackBody(raw) || {};
  const server = getServer();
  if (!server) return warn("Couldn't finish signing in to Weft", "The board's server isn't running yet.");
  try {
    const res = await fetch(`${server.url}/api/account/weft-callback`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-threadboard": "1" },
      body: JSON.stringify(body),
    });
    if (res.ok) return;
    const detail = res.headers.get("content-type")?.includes("text/html") ? await extractErrorMessage(res) : `The server answered ${res.status}.`;
    warn("Couldn't sign in to Weft", detail);
  } catch (err) {
    warn("Couldn't finish signing in to Weft", err.message);
  }
}

module.exports = { createAccountLink, handleAccountCallback, isAccountCallback, accountCallbackBody, extractErrorMessage, ACCOUNT_CALLBACK_HOST };
