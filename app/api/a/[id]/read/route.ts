// POST /api/a/<id>/read — a hosted mini app's weft.read: a named read from row.manifest.reads, run by the
// same code the Mac runs them with (electron/app-read-core.cjs, through lib/app-read.ts). Two reads:
// a Supabase RPC and a GA4 runReport. Both need an author secret; we read it from the store. The gate,
// the rate limit and a per-read log row cover the rest. Refusals answer { error, status }.
import { connection } from "next/server";
import { appShareAccess } from "@/lib/app-share-access";
import { clientIpFromHeaders, fetchLimitVerdict, insertFetchLog } from "@/lib/app-fetch-limit";
import { type ReadEntry, readStatus, runHostedRead } from "@/lib/app-read";
import { isConfigured as secretsConfigured } from "@/lib/app-secrets";
import { createAppSecretStore } from "@/lib/app-secret-store";
import { serviceClient, webUser } from "@/lib/web-session";

const MAX_BODY_BYTES = 64 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };
const READ_NAME_RE = /^[a-z][a-z0-9_-]{0,39}$/;
const SUPABASE_NEEDS = ["SUPABASE_SECRET_KEY"];
const GA4_NEEDS = ["GA4_PROPERTY_ID", "GA4_SERVICE_ACCOUNT_JSON"];

function reject(status: number, error: string): Response {
  return Response.json({ error, status }, { status, headers: NO_STORE });
}

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
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) return reject(413, "request body is too large.");
  let body: unknown;
  try { body = await req.json(); } catch { return reject(400, "request body must be JSON."); }
  if (!body || typeof body !== "object") return reject(400, "request shape isn't valid.");
  const m = body as Record<string, unknown>;
  const name = typeof m.name === "string" ? m.name : "";
  if (!READ_NAME_RE.test(name)) return reject(400, "read name isn't valid.");
  const args = m.args && typeof m.args === "object" && !Array.isArray(m.args) ? (m.args as Record<string, unknown>) : undefined;
  return { name, args };
}

async function loadReadEntry(id: string, name: string): Promise<{ entry: ReadEntry; manifest: unknown } | Response> {
  const access = await appShareAccess(id);
  if (access.kind === "missing") return reject(404, "this app link no longer exists.");
  if (access.kind !== "ok") return reject(403, "you don't have access to this app link.");
  const reads = access.share.manifest?.reads ?? null;
  if (!reads) return reject(404, "this app has no reads.");
  const entry = (reads as Record<string, ReadEntry>)[name];
  if (!entry || typeof entry !== "object") return reject(404, `read ${name} isn't in the manifest.`);
  return { entry, manifest: access.share.manifest };
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

// Runs the read after parseReadRequest has approved the body + manifest entry. The rate limit and the
// log row cover the rest; readStatus turns the core's refusal kind (or the upstream's status) into the response's.
// Which author secrets the entry needs to read. Returns an empty list for a row we don't recognise
// (the caller then skips the secret store entirely).
function needsFor(entry: ReadEntry): string[] {
  if (entry.supabase) return SUPABASE_NEEDS;
  if (entry.ga4) return GA4_NEEDS;
  return [];
}

async function runRead(req: Request, id: string, parsed: ParsedRead): Promise<Response> {
  const { name, args, entry, manifest } = parsed;
  const service = serviceClient();
  if (!service) return reject(503, "this server isn't configured to run apps.");
  const viewer = await webUser();
  const viewerId = viewer?.id ?? null;
  const verdict = await checkRateLimit(req, id, viewerId, name, entry);
  if (verdict) return verdict;
  const needs = needsFor(entry);
  if (needs.length > 0 && !secretsConfigured()) return reject(503, "App secrets aren't set up on this server.");
  const store = createAppSecretStore(service);
  const values = needs.length > 0 ? await store.getValues(id, { author: needs, viewer: [] }, null) : {};
  const host = readHost(entry);
  try {
    const rows = await runHostedRead(entry, manifest, args, values);
    await insertFetchLog(service, { shareId: id, viewerId, method: "READ", host, path: `/${name}`, status: 200 });
    return Response.json({ rows }, { headers: NO_STORE });
  } catch (err) {
    const status = readStatus(err);
    await insertFetchLog(service, { shareId: id, viewerId, method: "READ", host, path: `/${name}`, status });
    return reject(status, err instanceof Error ? err.message : String(err));
  }
}

// 429 + Retry-After with a log row. Returns null when the request is allowed to proceed.
async function checkRateLimit(
  req: Request,
  id: string,
  viewerId: string | null,
  name: string,
  entry: ReadEntry,
): Promise<Response | null> {
  const service = serviceClient();
  if (!service) return reject(503, "this server isn't configured to run apps.");
  const clientIp = clientIpFromHeaders(req.headers);
  const verdict = await fetchLimitVerdict(service, id, viewerId, clientIp);
  if (verdict.ok) return null;
  const host = readHost(entry);
  await insertFetchLog(service, { shareId: id, viewerId, method: "READ", host, path: `/${name}`, status: 429 });
  return new Response(JSON.stringify({ error: "rate limit exceeded", status: 429 }), { status: 429, headers: { ...NO_STORE, "Retry-After": String(verdict.retryAfter) } });
}