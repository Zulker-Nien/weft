# 026: a mini app's manifest could point Supabase reads at a host of its choosing, exfiltrating the author's service key

**Date:** 2026-10-20 · **Severity:** High (a share the author published handed their live `SUPABASE_SECRET_KEY` to any host on the internet)

## Symptom

A hosted mini app's `weft-app.json` manifest can declare Supabase reads. `runSupabaseRead` in
`app/api/a/[id]/read/route.ts` fetches the manifest's `supabaseUrl` and sends the app **author's** real
`SUPABASE_SECRET_KEY` as both the `apikey` header and `Authorization: Bearer`, then returns the response
to the caller. Nothing constrained where that key went: a manifest naming an attacker-controlled host
made weft.zip hand over the author's service key to it on the first read. The share link is itself the
delivery mechanism — an authenticated proxy into the author's Supabase project, handed out by the author
themselves. Found in the 2026-10-20 pentest as F-11.

## Cause

`reducedManifest` in `lib/app-folder.ts` built `cloud_app_shares.manifest` by copying four fields out of
the manifest with shape checks only. A `supabaseUrl` passed `typeof v === "string"`, so it landed in the
row verbatim — and `runSupabaseRead` read it back out and used it as a fetch base, with no host check on
either side. The rule was missing at the point the value was persisted *and* at the point it was used.

```ts
// before
export function reducedManifest(raw: unknown): AppManifestUpload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  return {
    ...(isPlain(r.secrets) ? { secrets: r.secrets } : {}),
    ...(Array.isArray(r.public) ? { public: r.public } : {}),
    ...(isPlain(r.reads) ? { reads: r.reads } : {}),
    ...(typeof r.supabaseUrl === "string" && r.supabaseUrl ? { supabaseUrl: r.supabaseUrl } : {}),
  };
}
```

```ts
// before — runSupabaseRead, app/api/a/[id]/read/route.ts
if (!RPC_FN_RE.test(fn)) throw new AppReadError(`Function name isn't a Postgres identifier.`, 400);
const secret = values.SUPABASE_SECRET_KEY;
if (!secret) throw new AppReadError(`SUPABASE_SECRET_KEY has no value yet.", 400);
const cleaned = cleanArgs(declaredArgs, pageArgs);
const target = new URL(`/rest/v1/rpc/${fn}`, supabaseUrl);   // <- any host at all
```

## Fix

One rule, expressed once, applied twice.

`safeSupabaseUrl` in `lib/app-folder.ts` accepts only an `https` URL whose hostname is a bare Supabase
project host — no credentials in the URL, no port, and a `$`-anchored pattern so `abc.supabase.co.evil.example`
can't slip through — and returns the normalised origin:

```ts
const SUPABASE_HOST_RE = /^[a-z0-9][a-z0-9-]*\.supabase\.(co|in)$/i;

export function safeSupabaseUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  // No credentials in the URL, and no port: the host must be the bare project host.
  if (url.username || url.password || url.port) return null;
  if (!SUPABASE_HOST_RE.test(url.hostname)) return null;
  return url.origin;
}
```

`reducedManifest` drops the value when it fails, so a bad `supabaseUrl` never reaches
`cloud_app_shares.manifest`. `runSupabaseRead` checks again per read and refuses with a 400 **before** the
secret is decrypted or any fetch happens, so rows written before the rule still can't leak:

```ts
// after
const origin = safeSupabaseUrl(supabaseUrl);
if (!origin) throw new AppReadError("This app's supabaseUrl isn't a Supabase project URL.", 400);
const secret = values.SUPABASE_SECRET_KEY;
if (!secret) throw new AppReadError("SUPABASE_SECRET_KEY has no value yet.", 400);
const cleaned = cleanArgs(declaredArgs, pageArgs);
const target = new URL(`/rest/v1/rpc/${fn}`, origin);
```

**Key rule:** a URL from untrusted data that decides where a secret is sent is itself a secret-handling
decision — validate it against an allowlist of hosts that can only ever be the intended provider, both
where the value is stored and where it is used, so neither a hand-edited manifest nor a row written
before the rule can aim a key somewhere else.

Custom domains and self-hosted Postgres are deliberately **not** usable as a read host; that is the cost
of a rule that can't be talked out of.

**Files:** `lib/app-folder.ts`, `lib/app-folder.test.ts` (the validator, and that a hostile value never
reaches the row), `app/api/a/[id]/read/route.ts`, `app/api/a/[id]/read/routes.test.ts` (four bad URLs
each assert a 400 and that `fetch` was never called), `docs/architecture/mini-app-hosting.md`,
`CHANGELOG.md`.