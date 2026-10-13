// Email forwarding for Weft's own domain (docs/architecture/email-forwarding.md), served by the deployed Weft on Vercel at
// /api/email/webhook (app/api/email/webhook/route.ts). Resend receives every mail to weft.zip (the domain's MX record) and
// posts an email.received event, signed the Svix way: svix-id, svix-timestamp and svix-signature over `id.timestamp.body`
// with the webhook's whsec_ secret. The event carries only metadata, so a delivery that checks out is read back in full
// from Resend's receiving API and sent on through Resend to the inbox in EMAIL_FORWARD_TO, the original sender as reply-to.

export interface ReceivedEvent {
  type: string;
  data: { email_id: string };
}

export interface Mail {
  from: string;
  to: string[];
  reply_to: string[];
  subject: string;
  html: string | null;
  text: string | null;
}

export interface Received {
  filename: string;
  content_type: string;
  content_disposition: string;
  download_url: string;
}

export interface Attachment {
  filename: string;
  content: string; // base64
  content_type: string;
}

export interface Outgoing {
  from: string;
  to: string[];
  reply_to: string[];
  subject: string;
  html?: string;
  text?: string;
  headers: Record<string, string>;
  attachments?: Attachment[];
}

export interface Mailer {
  received: (id: string) => Promise<Mail>;
  attachments: (id: string) => Promise<Received[]>;
  download: (url: string) => Promise<string>;
  send: (mail: Outgoing) => Promise<string>;
}

export interface Forwarding {
  secret: string;
  to: string;
  from: string;
  mailer: Mailer;
  now?: number;
}

// How far off a delivery's timestamp may be, in seconds, before it's taken for a replay.
export const TOLERANCE = 5 * 60;

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain" } });

// Compares every character, so how long it takes says nothing about where a forged signature goes wrong.
export function sameSignature(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Svix's signature: base64 HMAC-SHA256 of `id.timestamp.body`, keyed by the secret after its whsec_ prefix, base64-decoded.
export async function svixSignature(secret: string, id: string, timestamp: string, body: string) {
  const raw = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`))).toString("base64");
}

// Why a delivery can't be trusted, or null when it can: all three headers, a timestamp within TOLERANCE of now, and one
// of the header's space-separated `v1,…` signatures matching ours.
export async function refusal(headers: Headers, body: string, secret: string, now = Date.now()): Promise<string | null> {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures) return "Missing signature headers";
  const at = Number(timestamp);
  if (!Number.isFinite(at) || Math.abs(now / 1000 - at) > TOLERANCE) return "Stale timestamp";
  const want = await svixSignature(secret, id, timestamp, body);
  return signatures.split(" ").some((s) => s.startsWith("v1,") && sameSignature(s.slice(3), want)) ? null : "Bad signature";
}

// `Jane Doe <jane@example.com>` is a name and an address; a bare address has no name.
export function parseAddress(raw: string): { name: string; address: string } {
  const [, name = "", address = ""] = /^\s*"?(.*?)"?\s*<([^>]+)>\s*$/.exec(raw) ?? [];
  return address ? { name: name.trim(), address: address.trim() } : { name: "", address: raw.trim() };
}

// The mail that goes on: from the forwarding address, named for the sender and the alias they wrote to, so the inbox
// shows both at a glance; replies go to the sender (or their reply-to); the original addresses ride along as headers.
export function forwardMessage(mail: Mail, to: string, from: string, attachments: Attachment[]): Outgoing {
  const sender = parseAddress(mail.from);
  const alias = mail.to[0] ?? from;
  const name = (sender.name || sender.address).replace(/"/g, "'");
  const out: Outgoing = {
    from: `"${name} via ${alias}" <${from}>`,
    to: [to],
    reply_to: mail.reply_to.length ? mail.reply_to : [sender.address],
    subject: mail.subject || "(no subject)",
    headers: { "X-Forwarded-From": mail.from, "X-Forwarded-To": mail.to.join(", ") },
  };
  if (mail.html) out.html = mail.html;
  if (mail.text) out.text = mail.text;
  if (!mail.html && !mail.text) out.text = "(no content)";
  if (attachments.length) out.attachments = attachments;
  return out;
}

export async function handle(req: Request, o: Forwarding): Promise<Response> {
  if (req.method !== "POST") return text("POST only", 405);
  const body = await req.text();
  const refused = await refusal(req.headers, body, o.secret, o.now);
  if (refused) return text(refused, 401);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return text("Not JSON", 400);
  }
  const event = (parsed ?? {}) as Partial<ReceivedEvent>;
  const id = event.data?.email_id;
  if (event.type !== "email.received" || typeof id !== "string") return text(`Ignored ${event.type || "event"}`, 202);
  const mail = await o.mailer.received(id);
  // Inline images are already in the HTML (as data URIs), so only the real attachments are fetched and sent on.
  const files = (await o.mailer.attachments(id)).filter((a) => a.content_disposition !== "inline");
  const attachments = await Promise.all(
    files.map(async (a) => ({ filename: a.filename, content_type: a.content_type, content: await o.mailer.download(a.download_url) })),
  );
  const sent = await o.mailer.send(forwardMessage(mail, o.to, o.from, attachments));
  return text(`Forwarded as ${sent}`, 200);
}

// The Mailer on Resend's REST API, with a "Full access" key.
export function restMailer(key: string, fetchFn: typeof fetch = fetch): Mailer {
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetchFn(`https://api.resend.com${path}`, { ...init, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" } });
    if (!res.ok) throw new Error(`Resend ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
    const json: unknown = await res.json();
    return json;
  };
  return {
    received: async (id) => (await call(`/emails/receiving/${id}`)) as Mail,
    attachments: async (id) => ((await call(`/emails/receiving/${id}/attachments`)) as { data?: Received[] }).data ?? [],
    download: async (url) => {
      const res = await fetchFn(url);
      if (!res.ok) throw new Error(`Resend ${res.status} downloading an attachment`);
      return Buffer.from(await res.arrayBuffer()).toString("base64");
    },
    send: async (mail) => ((await call("/emails", { method: "POST", body: JSON.stringify(mail) })) as { id: string }).id,
  };
}
