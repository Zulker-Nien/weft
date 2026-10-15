// Shared helpers for the Puku proxy tests (lib/puku-proxy.test.ts, lib/puku-proxy-plan.test.ts).
// vitest.config.ts excludes *.harness.ts from coverage.

import { vi } from "vitest";
import { signTrialToken } from "./puku-trial-token";
import type { ProxyConfig, Usage, UsageStore } from "./puku-proxy";

export const SECRET = "s3cret";
export const NOW = Date.parse("2026-10-13T12:00:00Z");
export const ZERO: Usage = { requests: 0, input_tokens: 0, cache_read_tokens: 0, output_tokens: 0 };
export const enc = new TextEncoder();

export const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

export function memoryStore(first: Partial<Usage> = { requests: 1 }): UsageStore {
  const add = vi.fn<UsageStore["add"]>();
  add.mockResolvedValueOnce({ ...ZERO, ...first });
  add.mockResolvedValue(ZERO);
  return { add } satisfies UsageStore;
}

export const config = (over: Partial<ProxyConfig> = {}): ProxyConfig => ({ apiKey: "real-key", secret: SECRET, store: memoryStore(), now: () => NOW, ...over });

export async function request(path: string, init: Omit<RequestInit, "headers"> & { token?: string; headers?: Record<string, string> } = {}): Promise<Request> {
  const { token = (await signTrialToken("u1", SECRET, NOW)).token, headers, ...rest } = init;
  return new Request(`https://weft.example/api/puku/v1/${path}`, { method: "POST", body: "{}", ...rest, headers: { "x-api-key": token, ...headers } });
}

export const sse = (events: unknown[]) => events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join("");

export const ok = (body: BodyInit | null = "{}", headers: Record<string, string> = { "content-type": "application/json" }, status = 200) => new Response(body, { status, headers });
