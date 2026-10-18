// Type shim for ./app-data-reads.cjs so the test file (and any future TS importer) gets real types
// instead of `any`. The runtime module is unchanged; only TS uses these declarations.

export const RPC_FN: RegExp;
export const READ_NAME: RegExp;
export const ROW_LIMIT: number;
export const BYTE_LIMIT: number;
export const TIMEOUT_MS: number;

export function upstreamMessage(text: string, fallback: string): string;
export function isPrimitive(v: unknown): v is string | number | boolean;

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
  fetch: (url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
  now?: () => number;
}): Promise<{ accessToken: string; expiresAt: number }>;

export function runSupabase(opts: {
  supabaseUrl: string;
  fn: string;
  declaredArgs: Record<string, unknown> | undefined;
  pageArgs: Record<string, unknown> | null | undefined;
  values: Record<string, string>;
  fetch: (url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
}): Promise<unknown>;

export function flattenGa4(report: { dimensionHeaders?: { name: string }[]; metricHeaders?: { name: string }[]; rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[] }): Record<string, string | number>[];

export function runGa4(opts: {
  body: Record<string, unknown>;
  values: Record<string, string>;
  fetch: (url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
  now?: () => number;
  tokens: Map<string, { accessToken: string; expiresAt: number }>;
}): Promise<Record<string, string | number>[]>;
