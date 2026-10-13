import { sameSignature } from "./github-relay";

// The Vercel webhook relay (docs/architecture/vercel.md), served by the deployed Weft at /api/vercel/webhook
// (app/api/vercel/webhook/route.ts), since Vercel can't reach a Weft on localhost. A team's webhook posts each
// env-variable event to …/api/vercel/webhook?hook=<id>; Vercel's secret for that hook signs the body (x-vercel-signature,
// HMAC-SHA1), and only a delivery that checks out becomes a vercel_events row, which your Weft hears through Realtime
// and pulls that project's new variables into the 🔐 vault (lib/vercel-hooks.ts). The payload never holds a value.

export interface VercelHook {
  id: string;
  user_id: string;
  team_id: string;
  secret: string;
}

export interface VercelHookEvent {
  hook_id: string;
  user_id: string;
  team_id: string;
  project_id: string;
  type: string;
  event_id: string | null;
}

export interface VercelHookStore {
  hook: (id: string) => Promise<VercelHook | null>;
  save: (event: VercelHookEvent) => Promise<void>;
}

// The events Weft acts on; anything else Vercel sends is acknowledged and dropped.
export const EVENTS = new Set(["project.env-variable.created", "project.env-variable.updated"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain" } });

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function signature(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}

interface Payload {
  id?: unknown;
  type?: unknown;
  payload?: { team?: { id?: unknown } | null; projectId?: unknown };
}

export async function handle(req: Request, store: VercelHookStore): Promise<Response> {
  if (req.method !== "POST") return text("POST only", 405);
  const id = new URL(req.url).searchParams.get("hook") ?? "";
  if (!UUID.test(id)) return text("Unknown hook", 404);
  const hook = await store.hook(id);
  if (!hook) return text("Unknown hook", 404);

  const body = await req.text();
  const sent = req.headers.get("x-vercel-signature") ?? "";
  if (!sameSignature(sent, await signature(hook.secret, body))) return text("Bad signature", 401);

  const read = toEvent(hook, body);
  if (typeof read === "string") return text(read, read.startsWith("Ignored") ? 202 : 400);
  await store.save(read);
  return text("Saved", 200);
}

// The row a delivery becomes, or why it can't: a body that isn't JSON, an event Weft doesn't use, or another team's.
export function toEvent(hook: VercelHook, body: string): VercelHookEvent | string {
  let event: Payload;
  try {
    event = JSON.parse(body) as Payload;
  } catch {
    return "Body isn't JSON";
  }
  const type = typeof event.type === "string" ? event.type : "";
  if (!EVENTS.has(type)) return `Ignored ${type || "event"}`;
  const team = event.payload?.team?.id;
  if (typeof team === "string" && team !== hook.team_id) return "Wrong team for this hook";
  const project = event.payload?.projectId;
  if (typeof project !== "string" || !project) return "No project in the event";
  return { hook_id: hook.id, user_id: hook.user_id, team_id: hook.team_id, project_id: project, type, event_id: typeof event.id === "string" ? event.id : null };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Hooks and events through Supabase's REST API with a secret key, which skips row-level security: only this relay
// holds one. A new-style sb_secret_ key goes in apikey alone; a legacy service_role JWT also as the bearer.
export function restStore(url: string, key: string, now = () => Date.now()): VercelHookStore {
  const headers: Record<string, string> = { apikey: key, "content-type": "application/json" };
  if (!key.startsWith("sb_")) headers.authorization = `Bearer ${key}`;
  async function rest(path: string, init: RequestInit = {}) {
    const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
    // 409: Vercel retried one it already delivered (same event id).
    if (!res.ok && res.status !== 409) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    return res;
  }
  return {
    hook: async (id) => {
      const rows = (await (await rest(`vercel_hooks?id=eq.${id}&select=id,user_id,team_id,secret`)).json()) as VercelHook[];
      return rows[0] ?? null;
    },
    save: async (event) => {
      await rest("vercel_events", { method: "POST", body: JSON.stringify(event), headers: { prefer: "return=minimal" } });
      // A hook's events older than a day are no use to anyone: Weft only needs to hear new ones.
      const old = new Date(now() - DAY_MS).toISOString();
      await rest(`vercel_events?hook_id=eq.${event.hook_id}&created_at=lt.${old}`, { method: "DELETE" });
    },
  };
}
