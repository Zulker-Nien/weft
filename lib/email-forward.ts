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

// Strips ASCII control bytes (0x00–0x1F and 0x7F) from a string so it can sit inside an RFC 5322
// header value without smuggling extra fields (CR/LF/NUL). Used on the From display name and
// any header we round-trip from the original message (pentest 2026-10-20, F-7).
// The control-character class is intentional: it's the whole point of the helper.
function stripControlBytes(text: string): string {
  return text.replace(/[\x00-\x1F\x7F]/g, "");
}

// `Jane Doe <jane@example.com>` is a name and an address; a bare address has no name. The
// `(.*?)` is non-greedy on purpose: a malicious or noisy input might contain a `<` in the
// leading text and we want it to land in the bare-address branch ("name": "", address: raw)
// rather than mis-parsing as a different address. The address half `<([^>]+)>` can't itself
// contain `<`, so the part inside the angle brackets is safely bounded.
export function parseAddress(raw: string): { name: string; address: string } {
  const stripped = stripControlBytes(raw);
  const [, name = "", address = ""] = /^\s*"?(.*?)"?\s*<([^>]+)>\s*$/.exec(stripped) ?? [];
  return address ? { name: name.trim(), address: address.trim() } : { name: "", address: stripped.trim() };
}

// The mail that goes on: from the forwarding address, named for the sender and the alias they wrote to, so the inbox
// shows both at a glance; replies go to the sender (or their reply-to); the original addresses ride along as headers.
//
// The sender name and the round-tripped X-Forwarded-* headers are sanitised so an attacker who
// controls the original mail's From can't smuggle extra headers (a CR/LF/NUL in the display
// name becomes a literal space, a header value gets any control bytes dropped — pentest 2026-10-20,
// F-7). The From display name also swaps a remaining double quote for an apostrophe as a
// belt-and-braces measure; any control byte left after the strip is gone.
export function forwardMessage(mail: Mail, to: string, from: string, attachments: Attachment[]): Outgoing {
  const sender = parseAddress(mail.from);
  const alias = stripControlBytes(mail.to[0] ?? from).replace(/[<>,"]/g, "");
  const name = (sender.name || sender.address).replace(/"/g, "'");
  const out: Outgoing = {
    from: `"${name} via ${alias}" <${from}>`,
    to: [to],
    reply_to: mail.reply_to.length ? stripControlList(mail.reply_to) : [sender.address],
    subject: stripControlBytes(mail.subject) || "(no subject)",
    headers: {
      "X-Forwarded-From": stripControlBytes(mail.from),
      "X-Forwarded-To": stripControlList(mail.to).join(", "),
    },
  };
  if (mail.html) out.html = mail.html;
  if (mail.text) out.text = mail.text;
  if (!mail.html && !mail.text) out.text = "(no content)";
  if (attachments.length) out.attachments = attachments;
  return out;
}

// Sanitises each address in a list the same way parseAddress does on the From header. Resend
// validates reply-to and address shapes for outgoing mail, but we don't want to bet on that.
function stripControlList(values: string[]): string[] {
  return values.map((v) => stripControlBytes(v));
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
  const drop = shouldDrop(mail);
  if (drop) return text(`Dropped ${drop}`, 200);
  // Inline images are already in the HTML (as data URIs), so only the real attachments are fetched and sent on.
  const files = (await o.mailer.attachments(id)).filter((a) => a.content_disposition !== "inline");
  const attachments = await Promise.all(
    files.map(async (a) => ({ filename: a.filename, content_type: a.content_type, content: await o.mailer.download(a.download_url) })),
  );
  const sent = await o.mailer.send(forwardMessage(mail, o.to, o.from, attachments));
  return text(`Forwarded as ${sent}`, 200);
}

// Address local-parts we never forward: DMARC aggregate reports, RFC 5321 §6.6.7 postmaster
// notices (bounces, NDRs, mail-loop reports), and abuse@ traffic the receiving inbox already
// handles. Sub-addresses like `dmarc-ripe` match too. Each one is a 200 so Resend doesn't
// retry; the reason goes to Vercel logs so the drop is auditable.
const DROPPED_LOCALS = ["dmarc", "postmaster", "abuse"] as const;

export function shouldDrop(mail: Pick<Mail, "to">): string | null {
  for (const addr of mail.to) {
    const at = addr.lastIndexOf("@");
    if (at < 0) continue;
    const local = addr.slice(0, at).toLowerCase();
    for (const prefix of DROPPED_LOCALS) {
      if (local === prefix || local.startsWith(`${prefix}-`)) return `${prefix}@ mail`;
    }
  }
  return null;
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
