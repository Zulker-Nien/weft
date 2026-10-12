import { connection } from "next/server";
import { finishSignIn } from "@/lib/account";
import { guard } from "@/lib/guard";

function escape(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// The tab the system browser is left on after signing in.
function page(title: string, detail: string, ok: boolean) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 -apple-system,system-ui,sans-serif;background:#f4f3ef;color:#1d1d1b}
@media (prefers-color-scheme:dark){body{background:#131312;color:#e9e7e2}}main{max-width:420px;padding:24px;text-align:center}
h1{font-size:20px;margin:0 0 8px}.mark{font-size:34px;color:${ok ? "#2f9e6b" : "#c2412d"}}p{opacity:.75;margin:0}</style></head>
<body><main><div class="mark">${ok ? "&#10003;" : "&#33;"}</div><h1>${escape(title)}</h1><p>${escape(detail)}</p></main></body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } });
}

// Supabase sends the browser here with ?code=… after GitHub, Google or a magic link. A forged link can't
// sign you in to someone else's account: the code only exchanges with the verifier this machine kept.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const params = new URL(req.url).searchParams;
  const failed = params.get("error_description") || params.get("error");
  if (failed) return page("Couldn't sign in to Weft", failed, false);
  try {
    const user = await finishSignIn(params.get("code") ?? "");
    const who = user.email ?? user.name;
    return page("Signed in to Weft", `${who ? `You're signed in as ${who}. ` : ""}You can close this tab and go back to Weft.`, true);
  } catch (err) {
    return page("Couldn't sign in to Weft", err instanceof Error ? err.message : String(err), false);
  }
}
