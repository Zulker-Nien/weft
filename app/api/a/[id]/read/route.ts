// POST /api/a/<id>/read — a hosted mini app's weft.read: a named read from row.manifest.reads, run by the
// same code the Mac runs them with (electron/app-read-core.cjs, through lib/app-read.ts). Two reads:
// a Supabase RPC and a GA4 runReport. Both need an author secret; we read it from the store. The gate,
// the rate limit and a per-read log row cover the rest. Refusals answer { error, status }.
import { connection } from "next/server";
import { type ReadEntry, runHostedRead } from "@/lib/app-read";
import { gateShare, parseBoundedBody, rateLimitGuard, reject, requireService, resolveValues, runLogged } from "@/lib/app-route-pipeline";
import { webUser } from "@/lib/web-session";

const MAX_BODY_BYTES = 64 * 1024;
const READ_NAME_RE = /^[a-z][a-z0-9_-]{0,39}$/;
const SUPABASE_NEEDS = ["SUPABASE_SECRET_KEY"];
const GA4_NEEDS = ["GA4_PROPERTY_ID", "GA4_SERVICE_ACCOUNT_JSON"];

// The host the read talks to, for the log row. Supabase reads report supabase.co; GA4 reads report
// analyticsdata.googleapis.com.
function readHost(entry: ReadEntry): string {
  if (entry.supabase) return "supabase.co";
  if (entry.ga4) return "analyticsdata.googleapis.com";
  return "";
}

interface ParsedRead {
  name: string;
  args: Record<string, unknown> | undefined;
  entry: ReadEntry;
  manifest: unknown;
}

interface ReadNameArgs {
  name: string;
  args: Record<string, unknown> | undefined;
}

async function parseReadBody(req: Request): Promise<ReadNameArgs | Response> {
  const parsed = await parseBoundedBody(req, MAX_BODY_BYTES);
  if (parsed instanceof Response) return parsed;
  const body = parsed.body;
  if (!body || typeof body !== "object") return reject(400, "request shape isn't valid.");
  const m = body as Record<string, unknown>;
  const name = typeof m.name === "string" ? m.name : "";
  if (!READ_NAME_RE.test(name)) return reject(400, "read name isn't valid.");
  const args = m.args && typeof m.args === "object" && !Array.isArray(m.args) ? (m.args as Record<string, unknown>) : undefined;
  return { name, args };
}

async function loadReadEntry(id: string, name: string): Promise<{ entry: ReadEntry; manifest: unknown } | Response> {
  const share = await gateShare(id);
  if (share instanceof Response) return share;
  const reads = share.manifest?.reads ?? null;
  if (!reads) return reject(404, "this app has no reads.");
  const entry = (reads as Record<string, ReadEntry>)[name];
  if (!entry || typeof entry !== "object") return reject(404, `read ${name} isn't in the manifest.`);
  return { entry, manifest: share.manifest };
}

async function parseReadRequest(req: Request, id: string): Promise<ParsedRead | Response> {
  const parsed = await parseReadBody(req);
  if (parsed instanceof Response) return parsed;
  const loaded = await loadReadEntry(id, parsed.name);
  if (loaded instanceof Response) return loaded;
  return { name: parsed.name, args: parsed.args, entry: loaded.entry, manifest: loaded.manifest };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await ctx.params;
  const parsed = await parseReadRequest(req, id);
  if (parsed instanceof Response) return parsed;
  return runRead(req, id, parsed);
}

// Which author secrets the entry needs to read. Returns an empty list for a row we don't recognise
// (the pipeline then skips the secret store entirely).
function needsFor(entry: ReadEntry): string[] {
  if (entry.supabase) return SUPABASE_NEEDS;
  if (entry.ga4) return GA4_NEEDS;
  return [];
}

// The shared pipeline (lib/app-route-pipeline.ts) after parseReadRequest: rate limit, the entry's author
// secrets, then the read, logged as READ /<name>. lib/app-read.ts puts each refusal's status on the error.
async function runRead(req: Request, id: string, parsed: ParsedRead): Promise<Response> {
  const { name, args, entry, manifest } = parsed;
  const service = requireService();
  if (service instanceof Response) return service;
  const viewer = await webUser();
  const attempt = { shareId: id, viewerId: viewer?.id ?? null, method: "READ", host: readHost(entry), path: `/${name}` };
  const limited = await rateLimitGuard(service, req, attempt);
  if (limited) return limited;
  const needs = needsFor(entry);
  const values = await resolveValues(service, id, needs, { author: needs, viewer: [] }, null);
  if (values instanceof Response) return values;
  return runLogged(service, attempt, async () => ({ status: 200, body: { rows: await runHostedRead(entry, manifest, args, values) } }));
}
