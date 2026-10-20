// Type shim for ./app-fetch-filled.cjs so the test file (and any future TS importer) gets real
// types instead of `any`. The runtime module is unchanged; only TS uses these declarations.

import type { AppFetchRequest } from "../lib/app-bridge";
import type { ParsedPolicy, PlanResult } from "./app-fetch-policy.cjs";

// A request as it arrives at the app boundary: the bridge fills headers, but planFetch, fillSecrets
// and verifyFilledUrl all treat a missing headers object as "no headers", so this module's
// signatures take headers as optional rather than the stricter shape AppFetchRequest itself uses.
export type FilledRequest = Omit<AppFetchRequest, "headers"> & { headers?: Record<string, string> };

// { ok: true, filledUrl } when the filled URL is safe to send, or { ok: false, status, error } on
// refusal: 400 for malformed (unparseable, userinfo, a %2f/%5c/%2e escape), 403 when a value moved
// the request to another host or port, or landed on a path a secret's rule no longer allows.
export type VerifyFilledUrlResult =
  | { ok: true; filledUrl: string }
  | { ok: false; status: 400 | 403; error: string };

// Re-checks the filled request after fillSecrets swapped placeholders for values: protocol, hostname
// and port must match the planned URL, the filled URL must not carry credentials, no percent-encoded
// slash/backslash/dot in either path, and every placeholder secret's own rule re-run against the
// filled path. A missing or already-refused plan is a 400. The status on a refusal is 400 for
// malformed and 403 for not allowed.
export function verifyFilledUrl(
  plan: PlanResult | null | undefined,
  request: FilledRequest,
  policy: ParsedPolicy | null | undefined,
): VerifyFilledUrlResult;