// The GitHub webhook relay (docs/architecture/github-issues.md), served by the deployed Weft on Vercel at
// /api/github/webhook (app/api/github/webhook/route.ts), since GitHub can't reach a Weft on localhost. GitHub posts
// each delivery to …/api/github/webhook?hook=<id>; the hook's secret signs the body (X-Hub-Signature-256), and only
// a delivery that checks out becomes a github_events row on Weft's Supabase, which your Weft hears through Realtime.

export interface Hook {
  id: string;
  user_id: string;
  repo: string;
  secret: string;
}

export interface HookEvent {
  hook_id: string;
  user_id: string;
  repo: string;
  event: string;
  action: string | null;
  issue_number: number | null;
  delivery: string | null;
}

export interface HookStore {
  hook: (id: string) => Promise<Hook | null>;
  save: (event: HookEvent) => Promise<void>;
}

// The events Weft acts on; anything else GitHub sends is acknowledged and dropped.
export const EVENTS = new Set(["issues"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain" } });

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function signature(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `sha256=${hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))}`;
}

// Compares every character, so how long it takes says nothing about where a forged signature goes wrong.
export function sameSignature(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface Payload {
  action?: unknown;
  issue?: { number?: unknown };
  repository?: { full_name?: unknown };
}

export async function handle(req: Request, store: HookStore): Promise<Response> {
  if (req.method !== "POST") return text("POST only", 405);
  const id = new URL(req.url).searchParams.get("hook") ?? "";
  if (!UUID.test(id)) return text("Unknown hook", 404);
  const hook = await store.hook(id);
  if (!hook) return text("Unknown hook", 404);

  const body = await req.text();
  const sent = req.headers.get("x-hub-signature-256") ?? "";
  if (!sameSignature(sent, await signature(hook.secret, body))) return text("Bad signature", 401);

  const event = req.headers.get("x-github-event") ?? "";
  if (event === "ping") return text("pong", 200);
  if (!EVENTS.has(event)) return text(`Ignored ${event || "event"}`, 202);

  const read = toEvent(hook, event, body, req.headers.get("x-github-delivery"));
  if (typeof read === "string") return text(read, 400);
  await store.save(read);
  return text("Saved", 200);
}

// The row a delivery becomes, or why it can't: a body that isn't JSON, or one about another repo.
export function toEvent(hook: Hook, event: string, body: string, delivery: string | null): HookEvent | string {
  let payload: Payload;
  try {
    payload = JSON.parse(body) as Payload;
  } catch {
    return "Body isn't JSON";
  }
  const repo = typeof payload.repository?.full_name === "string" ? payload.repository.full_name : "";
  if (repo.toLowerCase() !== hook.repo.toLowerCase()) return "Wrong repo for this hook";
  return {
    hook_id: hook.id,
    user_id: hook.user_id,
    repo: hook.repo,
    event,
    action: typeof payload.action === "string" ? payload.action : null,
    issue_number: typeof payload.issue?.number === "number" ? payload.issue.number : null,
    delivery,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Hooks and events through Supabase's REST API with a secret key, which skips row-level security: only this
// relay holds one. A new-style sb_secret_ key goes in apikey alone; a legacy service_role JWT also as the bearer.
export function restStore(url: string, key: string, now = () => Date.now()): HookStore {
  const headers: Record<string, string> = { apikey: key, "content-type": "application/json" };
  if (!key.startsWith("sb_")) headers.authorization = `Bearer ${key}`;
  async function rest(path: string, init: RequestInit = {}) {
    const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
    // 409: GitHub redelivered one it already sent (same delivery id).
    if (!res.ok && res.status !== 409) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    return res;
  }
  return {
    hook: async (id) => {
      const rows = (await (await rest(`github_hooks?id=eq.${id}&select=id,user_id,repo,secret`)).json()) as Hook[];
      return rows[0] ?? null;
    },
    save: async (event) => {
      await rest("github_events", { method: "POST", body: JSON.stringify(event), headers: { prefer: "return=minimal" } });
      // A hook's events older than a day are no use to anyone: Weft only needs to hear new ones.
      const old = new Date(now() - DAY_MS).toISOString();
      await rest(`github_events?hook_id=eq.${event.hook_id}&created_at=lt.${old}`, { method: "DELETE" });
    },
  };
}
