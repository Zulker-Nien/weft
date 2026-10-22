// The shared-app routes' replies (app/api/a/[id]/*, app/api/apps/*). They answer a page a saved mini
// app fetched, so every response must be uncacheable and every failure the same shape: `{ error, status }`
// with the status repeated in the body, so the page can read it without touching `Response.ok`.
//
// `NO_STORE` itself is one header object, shared: lib/share-page-serve.ts already exports the same
// constant and three routes import it from there, while the rest below each declared their own copy.

export const NO_STORE = { "Cache-Control": "no-store" } as const;

// A failed read, fetch, unlock or secret ask: the error under `error` and the HTTP status in both the
// status line and the body.
export function reject(status: number, error: string): Response {
  return Response.json({ error, status }, { status, headers: NO_STORE });
}

// A rate-limited reply, which also tells the page how long to wait.
export function rateLimited(retryAfter: number, error = "rate limit exceeded"): Response {
  return new Response(JSON.stringify({ error, status: 429 }), { status: 429, headers: { ...NO_STORE, "Retry-After": String(retryAfter) } });
}