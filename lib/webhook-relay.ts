// The webhook relay (docs/architecture/webhooks.md), served by the deployed Weft on Vercel at /api/hooks/<relay id>
// (app/api/hooks/[id]/[[...rest]]/route.ts), since a provider can't reach a dev server on localhost. Whatever it posts
// becomes a webhook_deliveries row on Weft's Supabase, which the owner's Weft hears through Realtime and forwards to
// the webhook's local target (lib/webhook-forward.ts). The relay id in the URL is the only check it makes: the
// provider's own signature is verified by the app at the target, over the body, which is kept byte-exact for that.

export interface Relay {
  id: string;
  user_id: string;
  name: string;
}

export interface DeliveryRow {
  relay_id: string;
  user_id: string;
  method: string;
  // Whatever followed the relay id in the URL: "/sub", "?foo=1", "/sub?foo=1", or "".
  path: string;
  headers: Record<string, string>;
  // The request body in base64.
  body: string;
}

export interface RelayStore {
  relay: (id: string) => Promise<Relay | null>;
  save: (delivery: DeliveryRow) => Promise<void>;
}

export const MAX_BODY = 1024 * 1024;
export const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain" } });

// Hop-by-hop headers, and the ones Vercel adds on the way in: none of them is the provider's.
const DROPPED = /^(host|connection|keep-alive|content-length|transfer-encoding|te|trailer|upgrade|forwarded|x-real-ip|x-forwarded-.*|x-vercel-.*)$/;

export function keptHeaders(headers: Headers): Record<string, string> {
  const kept: Record<string, string> = {};
  headers.forEach((value, name) => {
    const key = name.toLowerCase();
    if (!DROPPED.test(key)) kept[key] = value;
  });
  return kept;
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

export async function handle(req: Request, relayId: string, extra: string, store: RelayStore): Promise<Response> {
  if (!METHODS.has(req.method)) return text("Method not allowed", 405);
  if (!UUID.test(relayId)) return text("Unknown webhook", 404);
  const relay = await store.relay(relayId);
  if (!relay) return text("Unknown webhook", 404);

  // Refuse by the declared size first so an oversized body is never read, then by what actually arrived.
  if (Number(req.headers.get("content-length")) > MAX_BODY) return text("Body too large", 413);
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.length > MAX_BODY) return text("Body too large", 413);

  await store.save({ relay_id: relay.id, user_id: relay.user_id, method: req.method, path: extra, headers: keptHeaders(req.headers), body: base64(body) });
  return text("Relayed", 200);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Relays and deliveries through Supabase's REST API with a secret key, which skips row-level security: only this
// relay holds one. A new-style sb_secret_ key goes in apikey alone; a legacy service_role JWT also as the bearer.
export function restStore(url: string, key: string, now = () => Date.now()): RelayStore {
  const headers: Record<string, string> = { apikey: key, "content-type": "application/json" };
  if (!key.startsWith("sb_")) headers.authorization = `Bearer ${key}`;
  async function rest(path: string, init: RequestInit = {}) {
    const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    return res;
  }
  return {
    relay: async (id) => {
      const rows = (await (await rest(`webhook_relays?id=eq.${id}&select=id,user_id,name`)).json()) as Relay[];
      return rows[0] ?? null;
    },
    save: async (delivery) => {
      await rest("webhook_deliveries", { method: "POST", body: JSON.stringify(delivery), headers: { prefer: "return=minimal" } });
      // A relay's deliveries older than a day are no use to anyone: Weft forwards them within seconds, or on its next start.
      const old = new Date(now() - DAY_MS).toISOString();
      await rest(`webhook_deliveries?relay_id=eq.${delivery.relay_id}&created_at=lt.${old}`, { method: "DELETE" });
    },
  };
}
