// The hosted route's side of a data mini app's reads (app/api/a/[id]/read/route.ts). The reads themselves
// live in electron/app-read-core.cjs, the same code Electron main runs for a local app, so a fix to one is a
// fix to both (dde1126 gated the Supabase host here only, and the local copy stayed open). This file adds
// what only the server needs: the global fetch, one GA4 token cache for the process, and an HTTP status
// for each refusal kind the core throws.
import type { ReadError, ReadFetch } from "../electron/app-read-core.cjs";

type Core = typeof import("../electron/app-read-core.cjs");

export interface ReadEntry {
  supabase?: { fn: string; args?: unknown };
  ga4?: unknown;
}

// The status a refusal answers with. An upstream answer keeps the upstream's status; anything that isn't
// a read refusal at all is the route's 500.
const STATUS: Record<ReadError["kind"], number> = {
  "bad-request": 400,
  manifest: 400,
  missing: 400,
  "bad-args": 400,
  "too-large": 413,
  timeout: 504,
  network: 502,
  upstream: 502,
};

export function readStatus(err: unknown): number {
  const e = err as Partial<ReadError> | null;
  const kind = e && typeof e === "object" ? e.kind : undefined;
  if (!kind || !(kind in STATUS)) return 500;
  if (kind === "upstream" && typeof e?.status === "number") return e.status;
  return STATUS[kind];
}

// One cache entry per service-account email, for the life of the server process.
const gaTokens = new Map<string, { accessToken: string; expiresAt: number }>();

let core: Core | null = null;

// Imported, not required at the top, the way the fetch route loads app-fetch-run.cjs.
async function loadCore(): Promise<Core> {
  core ??= await import("../electron/app-read-core.cjs");
  return core;
}

const serverFetch: ReadFetch = (url, init) => fetch(url, init);

// Runs a manifest entry's read with the author's secret values. The Supabase read sends only the args the
// page passed (defaults: false), which is how the hosted read has always behaved; see cleanArgs in the core.
// A refusal leaves with its HTTP status on .status, which the route's pipeline (lib/app-route-pipeline.ts
// errStatus) answers with.
export async function runHostedRead(entry: ReadEntry, manifest: unknown, args: Record<string, unknown> | undefined, values: Record<string, string>): Promise<unknown> {
  try {
    return await runRead(await loadCore(), entry, manifest, args, values);
  } catch (err) {
    const status = readStatus(err);
    if (status !== 500) (err as ReadError).status = status;
    throw err;
  }
}

function runRead({ runSupabase, runGa4 }: Core, entry: ReadEntry, manifest: unknown, args: Record<string, unknown> | undefined, values: Record<string, string>): Promise<unknown> {
  if (entry.supabase) {
    return runSupabase({
      supabaseUrl: (manifest as { supabaseUrl?: string }).supabaseUrl ?? "",
      fn: entry.supabase.fn,
      declaredArgs: entry.supabase.args,
      pageArgs: args,
      values,
      fetch: serverFetch,
      defaults: false,
    });
  }
  return runGa4({ body: entry.ga4, values, fetch: serverFetch, tokens: gaTokens });
}
