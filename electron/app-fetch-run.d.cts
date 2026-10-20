// Type shim for ./app-fetch-run.cjs so the test file (and any future TS importer) gets real
// types instead of `any`. The runtime module is unchanged; only TS uses these declarations.

import type { AppFetchResult } from "../lib/app-bridge";
import type { ParsedPolicy, PlanResult, PolicyRequest } from "./app-fetch-policy.cjs";

export const ALLOWED_RESPONSE_HEADERS: Set<string>;
export const TEXTUAL_TYPES: string[];

// Throws an Error with a numeric `status` (400, 403, 409, 413, 502 or 504) when the request
// is refused, the secret layer is missing, the body cap is hit, the network call fails or
// the request times out. Returns an AppFetchResult on success.
export function runFetch(opts: {
  policy: ParsedPolicy;
  request: PolicyRequest;
  // Resolves to { NAME: value } for the placeholders the request needs. A missing name is a
  // 409 (the secret layer is the one that knows it isn't set). Unused when the request has
  // no placeholders.
  getValues: (names: string[]) => Promise<Record<string, string>> | Record<string, string>;
  // The outbound fetch; inject so tests don't need the network and so weft.zip / Electron
  // share the same code path.
  fetch: (url: string, init: { method?: string; headers?: Record<string, string>; body?: string; redirect?: "manual" | "follow"; signal?: AbortSignal }) => Promise<{
    status: number;
    ok: boolean;
    headers: { get(name: string): string | null; forEach(cb: (value: string, name: string) => void): void };
    body?: { getReader(): { read(): Promise<{ value: Uint8Array | undefined; done: boolean }>; cancel(): Promise<void> } } | null;
    arrayBuffer(): Promise<ArrayBuffer>;
  }>;
  // dns.lookup-style: (hostname, options, callback). Called with { all: true }; the request
  // is refused if ANY resolved address is private. Injected so the test avoids real DNS. The
  // callback params are loose (unknown error and nullable addresses) because tests pass either
  // `null` for both or a populated array, mirroring what dns.lookup may yield.
  lookup: (hostname: string, options: { all: true }, callback: (err: unknown, addresses: { address: string; family?: number }[] | null) => void) => void;
  timeoutMs?: number;
  maxBytes?: number;
}): Promise<AppFetchResult>;

// The path routes log for a request, taken from the PLAN, never from the filled URL: a
// placeholder in the query may carry a secret, so the log line must not see the value.
export function loggablePath(plan: PlanResult | null | undefined): string;
