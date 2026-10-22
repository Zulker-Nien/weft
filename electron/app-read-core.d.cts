// Type shim for ./app-read-core.cjs, for its tests and for lib/app-read.ts (the hosted route's side).
// The runtime module is unchanged; only TS uses these declarations.

/** A refusal: kind says what went wrong, status is the upstream's HTTP status when it answered. */
export interface ReadError extends Error {
  kind: "bad-request" | "manifest" | "missing" | "bad-args" | "upstream" | "too-large" | "timeout" | "network";
  status?: number;
}

export type ReadFetch = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export const RPC_FN: RegExp;
export const READ_NAME: RegExp;
export const ROW_LIMIT: number;
export const BYTE_LIMIT: number;
export const TIMEOUT_MS: number;

export function upstreamMessage(text: string, fallback: string): string;
export function isPrimitive(v: unknown): v is string | number | boolean;
export function safeSupabaseUrl(raw: unknown): string | null;
export function cleanArgs(declaredArgs: unknown, pageArgs: unknown, opts?: { defaults?: boolean }): Record<string, string | number | boolean>;

export function signServiceAccountJwt(opts: {
  clientEmail: string;
  privateKey: string;
  tokenUri?: string;
  now?: () => number;
}): string;

export function exchangeToken(opts: {
  clientEmail: string;
  privateKey: string;
  tokenUri?: string;
  fetch: ReadFetch;
  now?: () => number;
}): Promise<{ accessToken: string; expiresAt: number }>;

export function runSupabase(opts: {
  supabaseUrl: string;
  fn: string;
  declaredArgs: unknown;
  pageArgs: unknown;
  values: Record<string, string>;
  fetch: ReadFetch;
  defaults?: boolean;
}): Promise<unknown>;

export function flattenGa4(report: { dimensionHeaders?: { name: string }[]; metricHeaders?: { name: string }[]; rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[] }): Record<string, string | number>[];

export function runGa4(opts: {
  body: unknown;
  values: Record<string, string>;
  fetch: ReadFetch;
  now?: () => number;
  tokens: Map<string, { accessToken: string; expiresAt: number }>;
}): Promise<Record<string, string | number>[]>;
