// Type shim for ./app-fetch-policy.cjs so the test file (and any future TS importer) gets real
// types instead of `any`. The runtime module is unchanged; only TS uses these declarations.

import type { AppFetchRequest } from "../lib/app-bridge";

export const NAME_RE: RegExp;
export const METHODS: Set<string>;
export const FORBIDDEN_HEADERS: Set<string>;
export const PLACEHOLDER: RegExp;

export type HostRule = { kind: "exact"; name: string } | { kind: "wildcard"; base: string };

export interface SecretRule {
  from: "author" | "viewer";
  hosts: HostRule[];
  methods: string[];
  paths: string[];
}

export interface ParsedPolicy {
  secrets: Record<string, SecretRule>;
  public: string[];
  // Malformed manifest entries that were dropped rather than loosened. The caller can show this
  // list to the user so the manifest is fixed instead of silently narrowed.
  problems: string[];
}

export function parsePolicy(manifest: unknown): ParsedPolicy;

// A request as the caller hands it to the policy module: the bridge always carries headers, but
// the runtime tolerates a missing object (planFetch and fillSecrets both guard `request.headers`).
// Re-declared here with optional headers so tests can pass minimal `{ url, method }` literals.
export type PolicyRequest = Omit<AppFetchRequest, "headers"> & { headers?: Record<string, string> };

// The distinct placeholder names from the URL, every header value and the body, in encounter order.
export function secretNames(request: PolicyRequest | null | undefined): string[];

// { ok: true, url, method, names } when the request passes the policy, or
// { ok: false, status, error } on refusal: 400 for malformed, 403 for not allowed.
export type PlanResult =
  | { ok: true; url: string; method: string; names: string[] }
  | { ok: false; status: 400 | 403; error: string };

export function planFetch(policy: ParsedPolicy | null | undefined, request: PolicyRequest): PlanResult;

// True for any IP literal (v4 or v6) that points to a private, loopback, link-local, multicast
// or otherwise non-public range. IPv4-mapped and IPv4-compatible IPv6 forms are translated to
// their embedded v4 address first. Used by runFetch to refuse a DNS answer that resolves to one.
export function isPrivateAddress(ip: string | null | undefined): boolean;

// Returns a copy of the request with every `{{secret:NAME}}` placeholder replaced by the value
// in `values`. A name not in `values` is left as-is so the caller can decide what to do. A request
// with no headers object comes back with none: fillSecrets only walks headers when they are there.
export function fillSecrets(request: PolicyRequest, values: Record<string, string> | null | undefined): PolicyRequest;

// Replaces each value (length 4 or more) with `‹NAME›`. Used on utf8 bodies and header values
// before they cross back to the app, so a secret the server echoed isn't returned to the page.
export function maskSecrets(text: string, values: Record<string, string> | null | undefined): string;
