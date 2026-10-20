// POST /api/a/<id>/read — a hosted mini app's weft.read: a named read from row.manifest.reads, the same way
// the Mac's electron/app-data.cjs runs them (electron/app-data-reads.cjs runSupabase / runGa4). Two reads:
// a Supabase RPC and a GA4 runReport. Both need an author secret; we read it from the store. The gate,
// the rate limit and a per-read log row cover the rest. Refusals answer { error, status }.
import { connection } from "next/server";
import { appShareAccess } from "@/lib/app-share-access";
import { safeSupabaseUrl } from "@/lib/app-folder";
import { clientIpFromHeaders, fetchLimitVerdict, insertFetchLog } from "@/lib/app-fetch-limit";
import { AppReadError, BYTE_LIMIT, ROW_LIMIT, TIMEOUT_MS, exchangeGa4Token, upstreamMessage, withTimeout } from "@/lib/app-read-token";
import { isConfigured as secretsConfigured } from "@/lib/app-secrets";
import { createAppSecretStore } from "@/lib/app-secret-store";
import { serviceClient, webUser } from "@/lib/web-session";

const MAX_BODY_BYTES = 64 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };
const READ_NAME_RE = /^[a-z][a-z0-9_-]{0,39}$/;
const RPC_FN_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const SUPABASE_NEEDS = ["SUPABASE_SECRET_KEY"];
const GA4_NEEDS = ["GA4_PROPERTY_ID", "GA4_SERVICE_ACCOUNT_JSON"];

function reject(status: number, error: string): Response {
  return Response.json({ error, status }, { status, headers: NO_STORE });
}

interface ReadEntry {
  supabase?: { fn: string; args?: unknown };
  ga4?: unknown;
}

function isPrimitive(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

// Washes the page's args against the manifest's declared args. A page that asks for a missing key is
// silently dropped; a page that sends the wrong type is a 400.
function cleanArgs(declared: unknown, pageArgs: unknown): Record<string, string | number | boolean> {
  const cleaned: Record<string, string | number | boolean> = {};
  const d = declared && typeof declared === "object" && !Array.isArray(declared) ? (declared as Record<string, unknown>) : {};
  const g = pageArgs && typeof pageArgs === "object" && !Array.isArray(pageArgs) ? (pageArgs as Record<string, unknown>) : {};
  for (const [key, want] of Object.entries(d)) {
    if (!isPrimitive(want)) continue;
    if (!(key in g)) continue;
    const got = g[key];
    if (!isPrimitive(got)) throw new AppReadError(`Arg ${key} must be a string, number or boolean.`, 400);
    if (typeof want !== typeof got) throw new AppReadError(`Arg ${key} is a ${typeof want} in the manifest, not a ${typeof got}.`, 400);
    cleaned[key] = got;
  }
  return cleaned;
}

function flattenGa4(report: unknown): Record<string, unknown>[] {
  if (!report || typeof report !== "object") return [];
  const r = report as {
    dimensionHeaders?: { name: string }[];
    metricHeaders?: { name: string }[];
    rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[];
  };
  const dims = r.dimensionHeaders ?? [];
  const metrics = r.metricHeaders ?? [];
  const rows = (r.rows ?? []).slice(0, ROW_LIMIT);
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < dims.length; i++) {
      const dim = dims[i];
      if (!dim) continue;
      out[dim.name] = row.dimensionValues?.[i]?.value ?? "";
    }
    for (let i = 0; i < metrics.length; i++) {
      const metric = metrics[i];
      if (!metric) continue;
      const raw = row.metricValues?.[i]?.value;
      const n = Number(raw);
      out[metric.name] = Number.isFinite(n) ? n : raw;
    }
    return out;
  });
}

interface SupabaseReadInput {
  supabaseUrl: string;
  fn: string;
  declaredArgs: unknown;
  pageArgs: unknown;
  values: Record<string, string>;
}

async function runSupabaseRead({ supabaseUrl, fn, declaredArgs, pageArgs, values }: SupabaseReadInput): Promise<unknown> {
  if (!RPC_FN_RE.test(fn)) throw new AppReadError(`Function name isn't a Postgres identifier.`, 400);
  // The manifest's supabaseUrl decides where the author's SUPABASE_SECRET_KEY is sent, so it is
  // checked here as well as when the manifest was reduced: a row written before that rule (or one
  // written by any other path) must not be able to point the key at a host of its choosing.
  // safeSupabaseUrl returns the normalised origin or null; null refuses before the secret is read.
  const origin = safeSupabaseUrl(supabaseUrl);
  if (!origin) throw new AppReadError("This app's supabaseUrl isn't a Supabase project URL.", 400);
  const secret = values.SUPABASE_SECRET_KEY;
  if (!secret) throw new AppReadError("SUPABASE_SECRET_KEY has no value yet.", 400);
  const cleaned = cleanArgs(declaredArgs, pageArgs);
  const target = new URL(`/rest/v1/rpc/${fn}`, origin);
  for (const [k, v] of Object.entries(cleaned)) target.searchParams.set(k, String(v));
  const t = withTimeout(TIMEOUT_MS);
  try {
    const res = await fetch(target.toString(), {
      method: "GET",
      headers: { apikey: secret, authorization: `Bearer ${secret}`, accept: "application/json" },
      signal: t.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new AppReadError(upstreamMessage(text, `Supabase answered ${res.status}.`), res.status);
    if (text.length > BYTE_LIMIT) throw new AppReadError(`The read returned more than ${BYTE_LIMIT / 1024 / 1024} MB.`, 413);
    const json: unknown = text ? JSON.parse(text) : null;
    if (Array.isArray(json)) return json.slice(0, ROW_LIMIT);
    return json;
  } catch (err) {
    if (err instanceof AppReadError) throw err;
    const name = (err as { name?: unknown }).name;
    if (name === "AbortError") throw new AppReadError(`Supabase didn't answer in ${TIMEOUT_MS / 1000} s.`, 504);
    const message = err instanceof Error ? err.message : String(err);
    throw new AppReadError(`Couldn't reach Supabase: ${message}.`, 502);
  } finally {
    t.cancel();
  }
}

interface Ga4ReadInput {
  body: unknown;
  values: Record<string, string>;
}

async function runGa4Read({ body, values }: Ga4ReadInput): Promise<unknown> {
  const propertyId = values.GA4_PROPERTY_ID;
  if (!propertyId) throw new AppReadError("GA4_PROPERTY_ID has no value yet.", 400);
  const accessToken = await exchangeGa4Token(values);
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`;
  const t = withTimeout(TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: t.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new AppReadError(upstreamMessage(text, `GA4 answered ${res.status}.`), res.status);
    if (text.length > BYTE_LIMIT) throw new AppReadError(`The read returned more than ${BYTE_LIMIT / 1024 / 1024} MB.`, 413);
    return flattenGa4(JSON.parse(text));
  } catch (err) {
    if (err instanceof AppReadError) throw err;
    const name = (err as { name?: unknown }).name;
    if (name === "AbortError") throw new AppReadError(`GA4 didn't answer in ${TIMEOUT_MS / 1000} s.`, 504);
    const message = err instanceof Error ? err.message : String(err);
    throw new AppReadError(`Couldn't reach GA4: ${message}.`, 502);
  } finally {
    t.cancel();
  }
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
// log row cover the rest; AppReadError carries the status from upstream back to the response.
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
    const rows = await invokeRead(entry, manifest, args, values);
    await insertFetchLog(service, { shareId: id, viewerId, method: "READ", host, path: `/${name}`, status: 200 });
    return Response.json({ rows }, { headers: NO_STORE });
  } catch (err) {
    const status = err instanceof AppReadError ? err.status : 500;
    await insertFetchLog(service, { shareId: id, viewerId, method: "READ", host, path: `/${name}`, status });
    return reject(status, err instanceof Error ? err.message : String(err));
  }
}

// Picks the upstream runner for the read's declared entry.
async function invokeRead(entry: ReadEntry, manifest: unknown, args: Record<string, unknown> | undefined, values: Record<string, string>): Promise<unknown> {
  if (entry.supabase) {
    return runSupabaseRead({
      supabaseUrl: (manifest as { supabaseUrl?: string }).supabaseUrl ?? "",
      fn: entry.supabase.fn,
      declaredArgs: entry.supabase.args,
      pageArgs: args,
      values,
    });
  }
  return runGa4Read({ body: entry.ga4, values });
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