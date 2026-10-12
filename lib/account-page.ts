// The little green/red page the system browser is left on after the Weft account sign-in.
// /api/account/callback and /api/account/weft-callback both render it, so the user sees the same
// result whether the OAuth redirect hit the HTTP loopback (dev) or the weft:// handler (packaged).

function escape(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function accountPage(title: string, detail: string, ok: boolean): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 -apple-system,system-ui,sans-serif;background:#f4f3ef;color:#1d1d1b}
@media (prefers-color-scheme:dark){body{background:#131312;color:#e9e7e2}}main{max-width:420px;padding:24px;text-align:center}
h1{font-size:20px;margin:0 0 8px}.mark{font-size:34px;color:${ok ? "#2f9e6b" : "#c2412d"}}p{opacity:.75;margin:0}</style></head>
<body><main><div class="mark">${ok ? "&#10003;" : "&#33;"}</div><h1>${escape(title)}</h1><p>${escape(detail)}</p></main></body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } });
}
