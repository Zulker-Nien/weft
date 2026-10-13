// The desktop's forwarder to weft.zip's team API. The deployed Weft is the only place that has the
// service key for the orgs tables, so the desktop's local Next server asks weft.zip on the user's
// behalf using their own Supabase access token. This module is server-only: the access token and the
// fetch live here, not in a client component (lib/use-team.ts calls into this through /api/account/team).
import "server-only";

// The result every caller handles the same way. A non-2xx is just a status the JSON body explains.
export type ForwardResult = { status: number; json: unknown };

// A session-shaped object, so the test can pass a fake without pulling in @supabase/supabase-js.
export type SessionShape = {
  data: { session: { access_token: string } | null };
};

// The defaults the production build uses; `env` overrides them so a preview or test can point elsewhere.
type Deps = {
  session: SessionShape;
  fetchFn: typeof fetch;
  env: Record<string, string | undefined>;
};

const DEFAULT_TEAMS_URL = "https://weft.zip";

// 401 for the desktop's local route when no one is signed in here, and 502 with { error: "offline" } when
// fetch throws or the reply isn't JSON. The body shape matches what weft.zip's /api/teams sends back so
// the board can branch on json.error the same way the web page does.
export async function forwardTeam(method: "GET" | "POST", query: string, body: unknown, deps: Deps): Promise<ForwardResult> {
  const token = deps.session.data.session?.access_token;
  if (!token) return { status: 401, json: { error: "signed-out" } };

  const base = (deps.env.WEFT_TEAMS_URL || DEFAULT_TEAMS_URL).replace(/\/+$/, "");
  const url = `${base}/api/teams${query}`;
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  const init: RequestInit = { method, headers };
  if (method === "POST" && body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await deps.fetchFn(url, init);
  } catch {
    return { status: 502, json: { error: "offline" } };
  }

  // The desktop's UI only knows how to read JSON replies; anything else means the deployment is in a
  // bad state the user can't act on. Surfacing "bad-reply" instead of throwing keeps the page calm.
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    return { status: 502, json: { error: "bad-reply" } };
  }
  return { status: res.status, json };
}
