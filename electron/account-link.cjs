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

// Pulls the visible <h1> and <p> out of the rendered error page so the dialog shows the same
// message the user would have seen in a browser tab.
async function extractErrorMessage(res) {
  const html = await res.text();
  const h1 = /<h1>([\s\S]*?)<\/h1>/.exec(html)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "Sign-in failed";
  const p = /<p>([\s\S]*?)<\/p>/.exec(html)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
  return p ? `${h1}: ${p}` : h1;
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

module.exports = { createAccountLink, handleAccountCallback, isAccountCallback, accountCallbackBody, ACCOUNT_CALLBACK_HOST };
