// Same-origin sanitizer for a `?next=` value. The package's `safeNextPath`
// (aimhuge/auth) does the same thing — we copy it here so the local seam works
// before the upstream tag lands. A plain `startsWith("/") && !startsWith("//")`
// check is not enough: browsers parse `/\evil.com` (and `/<tab>/evil.com`) as
// `//evil.com`, which is a full URL in disguise. So the value is resolved the
// way a browser would resolve it, and only kept if it stays on the origin it
// started on. What comes back is the normalised path + query + hash, never a URL.
const PROBE_ORIGIN = "http://next-path.invalid";

export function safeNextPath(raw: string | readonly string[] | null | undefined, fallback: string): string {
  const value = typeof raw === "string" ? raw : raw?.[0];
  if (typeof value !== "string" || !value.startsWith("/")) return fallback;

  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PROBE_ORIGIN) return fallback;
  return url.pathname + url.search + url.hash;
}
