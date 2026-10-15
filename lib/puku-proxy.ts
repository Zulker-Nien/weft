import { verifyTrialToken } from "./puku-trial-token";

// The Puku trial's proxy (docs/architecture/puku-trial.md), served by the deployed Weft on Vercel at
// /api/puku/v1/* (app/api/puku/v1/[...path]/route.ts). A puku thread with no Puku login of its own sends its
// trial token as the API key; the proxy checks the token's signature, counts the request against the user's daily
// cap, swaps in Weft's own Puku key and passes the request to Puku's gateway, streaming the reply back untouched
// while it reads the tokens used from it.

export const UPSTREAM = "https://api-cli.puku.sh";
export const DAILY_REQUESTS = 300;
export const DAILY_TOKENS = 2_000_000;

// What one user used of the trial on one UTC day. Tokens count input (including cache writes) and output;
// cache reads are kept but don't count toward the cap, since they cost a fraction of the rest.
export interface Usage {
  requests: number;
  input_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
}

export interface UsageStore {
  // Adds to the user's row for the day and returns the totals after it.
  add: (userId: string, day: string, usage: Usage) => Promise<Usage>;
}

// The workspace paying for a user's Puku use and what's left of its allowance this period. `check` returning
// null is "no Pro allowance" — the proxy keeps the Free daily cap on for this user. A free or unpaid plan
// returns null, a Pro plan with tokens left returns its remaining count, and an over-limit Pro plan returns
// remaining 0.
export interface PlanMeter {
  // The workspace paying for this user's Puku use and what's left of its allowance this period, or null when the user's plan has none (the daily trial cap applies).
  check(userId: string): Promise<{ orgId: string; remaining: number } | null>;
  record(orgId: string, userId: string, tokens: number): Promise<void>;
}

export interface ProxyConfig {
  apiKey: string;
  secret: string;
  store: UsageStore;
  upstream?: string;
  dailyRequests?: number;
  dailyTokens?: number;
  now?: () => number;
  // When set, the proxy first asks the meter whether the user's workspace still has Puku tokens this period;
  // when the meter says yes, the daily cap is skipped (the day counter still updates) and tokens are billed
  // to the workspace at the end of the request.
  plan?: PlanMeter;
}

// Only what puku-cli calls: messages (and counting their tokens) and the model list.
const PATHS = /^(messages|messages\/count_tokens|models(\/[\w.-]+)?)$/;
// Request headers that describe the hop to Vercel, or carry the trial token, not the request itself.
const DROP_REQUEST = /^(host|connection|content-length|accept-encoding|cookie|authorization|x-api-key|forwarded|x-forwarded-.*|x-real-ip|x-vercel-.*|x-middleware-.*)$/i;
// fetch has already undone the gateway's compression and framing.
const DROP_RESPONSE = /^(content-encoding|content-length|transfer-encoding|connection)$/i;

const NO_USAGE: Usage = { requests: 0, input_tokens: 0, cache_read_tokens: 0, output_tokens: 0 };

export const today = (now: number) => new Date(now).toISOString().slice(0, 10);

// An error in the Messages API's own shape, so puku-cli shows its message as it would one from Anthropic.
export function apiError(status: number, type: string, message: string) {
  return Response.json({ type: "error", error: { type, message } }, { status });
}

export function trialToken(req: Request): string {
  const key = req.headers.get("x-api-key")?.trim();
  if (key) return key;
  return /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
}

export function overCap(usage: Usage, dailyRequests: number, dailyTokens: number) {
  return usage.requests > dailyRequests || usage.input_tokens + usage.output_tokens >= dailyTokens;
}

interface RawUsage {
  input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  output_tokens?: unknown;
}

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

// Folds one usage object from the reply into the running total. message_start carries the input counts, each
// message_delta the output so far (a running total, not an increment), so the larger of each wins.
export function mergeUsage(total: Usage, raw: RawUsage | undefined): Usage {
  if (!raw || typeof raw !== "object") return total;
  return {
    requests: total.requests,
    input_tokens: Math.max(total.input_tokens, count(raw.input_tokens) + count(raw.cache_creation_input_tokens)),
    cache_read_tokens: Math.max(total.cache_read_tokens, count(raw.cache_read_input_tokens)),
    output_tokens: Math.max(total.output_tokens, count(raw.output_tokens)),
  };
}

interface Event {
  usage?: RawUsage;
  message?: { usage?: RawUsage };
}

// The usage in one SSE data line, or in a whole JSON reply.
export function usageIn(text: string, total: Usage): Usage {
  try {
    const event = JSON.parse(text) as Event;
    return mergeUsage(mergeUsage(total, event.message?.usage), event.usage);
  } catch {
    return total;
  }
}

// Passes the reply through unchanged, reading usage from it on the way, and reports the total once it ends.
export function meter(streaming: boolean, done: (usage: Usage) => Promise<void>): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = "";
  let usage = NO_USAGE;
  const lines = (final: boolean) => {
    const parts = buffer.split("\n");
    buffer = final ? "" : (parts.pop() ?? "");
    for (const line of parts) if (line.startsWith("data:")) usage = usageIn(line.slice(5).trim(), usage);
  };
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      buffer += decoder.decode(chunk, { stream: true });
      if (streaming) lines(false);
    },
    async flush() {
      buffer += decoder.decode();
      if (streaming) lines(true);
      else usage = usageIn(buffer, usage);
      await done(usage).catch((err: unknown) => console.error(`Puku trial: couldn't record usage: ${(err as Error).message}`));
    },
  });
}

function forwardHeaders(req: Request, apiKey: string) {
  const headers = new Headers();
  req.headers.forEach((value, name) => {
    if (!DROP_REQUEST.test(name)) headers.set(name, value);
  });
  // puku-cli sends its key both ways, so the gateway gets it both ways too.
  headers.set("x-api-key", apiKey);
  headers.set("authorization", `Bearer ${apiKey}`);
  return headers;
}

// The trial user a request is for, or the error to answer it with: a bad method or path, a bad token, or a
// user over today's cap (a messages request counts toward it before it goes out).
async function admit(req: Request, path: string, config: ProxyConfig, day: string, now: number): Promise<{ userId: string; paid: { orgId: string; remaining: number } | null } | Response> {
  if (req.method !== "POST" && req.method !== "GET") return apiError(405, "invalid_request_error", "POST or GET only.");
  if (!PATHS.test(path)) return apiError(404, "not_found_error", `Weft's Puku trial doesn't serve /v1/${path}.`);
  const claims = await verifyTrialToken(trialToken(req), config.secret, now);
  if (!claims) return apiError(401, "authentication_error", "Weft's Puku trial token is missing or expired. Weft gets a new one while you're signed in to your Weft account.");
  if (!path.startsWith("messages")) return { userId: claims.sub, paid: null };
  // Pro workspaces bypass the daily cap. A billing outage must not block anyone, so a thrown check falls back
  // to the Free path; a thrown daily-cap add below would still let the user through to upstream.
  let paid: { orgId: string; remaining: number } | null = null;
  if (config.plan) {
    try {
      paid = await config.plan.check(claims.sub);
    } catch (err) {
      console.error(`Puku trial: plan meter check failed: ${(err as Error).message}`);
      paid = null;
    }
    if (paid && paid.remaining <= 0) {
      return apiError(429, "rate_limit_error", "This month's Weft Pro Puku allowance is used up. It resets at the start of your next billing period.");
    }
  }
  const used = await config.store.add(claims.sub, day, { ...NO_USAGE, requests: 1 });
  if (!paid && overCap(used, config.dailyRequests ?? DAILY_REQUESTS, config.dailyTokens ?? DAILY_TOKENS)) {
    return apiError(429, "rate_limit_error", "You've used today's free Puku trial in Weft. Log in to Puku (puku-cli auth login, or Settings → CLIs in Weft) to keep going, or try again tomorrow.");
  }
  return { userId: claims.sub, paid };
}

async function forward(req: Request, path: string, config: ProxyConfig): Promise<Response> {
  try {
    return await fetch(`${config.upstream ?? UPSTREAM}/v1/${path}${new URL(req.url).search}`, {
      method: req.method,
      headers: forwardHeaders(req, config.apiKey),
      body: req.method === "POST" ? await req.arrayBuffer() : undefined,
      signal: req.signal,
    });
  } catch (err) {
    return apiError(502, "api_error", `Couldn't reach Puku: ${(err as Error).message}`);
  }
}

export async function proxy(req: Request, path: string, config: ProxyConfig): Promise<Response> {
  const now = (config.now ?? Date.now)();
  const day = today(now);
  const admitted = await admit(req, path, config, day, now);
  if (admitted instanceof Response) return admitted;
  const { userId, paid } = admitted;

  const upstream = await forward(req, path, config);
  const headers = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!DROP_RESPONSE.test(name)) headers.set(name, value);
  });
  if (!path.startsWith("messages") || !upstream.ok || !upstream.body) return new Response(upstream.body, { status: upstream.status, headers });
  const streaming = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");
  const record = async (usage: Usage) => {
    if (usage.input_tokens || usage.cache_read_tokens || usage.output_tokens) {
      // The daily store always gets a row (per-day stats for the free trial stay accurate); a Pro workspace
      // also gets the charge against its monthly allowance. Cache reads don't count, matching overCap.
      await config.store.add(userId, day, usage);
      if (paid && config.plan) {
        const tokens = usage.input_tokens + usage.output_tokens;
        try {
          await config.plan.record(paid.orgId, userId, tokens);
        } catch (err) {
          console.error(`Puku trial: plan meter record failed: ${(err as Error).message}`);
        }
      }
    }
  };
  return new Response(upstream.body.pipeThrough(meter(streaming, record)), { status: upstream.status, headers });
}

// The usage table through Supabase's REST API with a secret key (it skips row-level security; only the deployed
// Weft holds one). One call to puku_trial_add both adds and returns the day's totals, so two requests at once
// can't both slip under the cap. A new-style sb_secret_ key goes in apikey alone; a legacy JWT also as the bearer.
export function restUsageStore(url: string, key: string): UsageStore {
  const headers: Record<string, string> = { apikey: key, "content-type": "application/json" };
  if (!key.startsWith("sb_")) headers.authorization = `Bearer ${key}`;
  return {
    add: async (userId, day, usage) => {
      const res = await fetch(`${url}/rest/v1/rpc/puku_trial_add`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          p_user: userId,
          p_day: day,
          p_requests: usage.requests,
          p_input: usage.input_tokens,
          p_cache_read: usage.cache_read_tokens,
          p_output: usage.output_tokens,
        }),
      });
      if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
      const row = (await res.json()) as Partial<Usage>;
      return {
        requests: count(row.requests),
        input_tokens: count(row.input_tokens),
        cache_read_tokens: count(row.cache_read_tokens),
        output_tokens: count(row.output_tokens),
      };
    },
  };
}
