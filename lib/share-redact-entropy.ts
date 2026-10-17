// High-entropy opaque tokens: long runs of base64/hex/url-safe characters with no whitespace.
// lib/share-redact.ts uses this to catch a custom API key (Redis, internal SaaS, a one-off hash)
// that lib/secret-detect.ts's pattern set doesn't know about. A known-safe shape (UUID, 32/40/64
// char hex hash, common ID formats) is whitelisted so ordinary text and code paths aren't flagged.
//
// Shannon entropy of a true random base64 string approaches log2(64) ≈ 6 bits per char; ordinary
// prose and identifiers max out around 4.5. The thresholds here (40+ chars, 4.7 bits/char over the
// alphabet we count) catch random tokens without false-positiving on real words.
//
// docs/architecture/sharing.md: this is the M-2 redactor; the share is best-effort by design and
// we document the gap. This module narrows it.

// The string's characters span at most log2(94) ≈ 6.55 bits per char; ASCII alphanumerics + - _ + / = gives 64.
// We treat anything over this as "looks random".
const MIN_ENTROPY = 4.7;

// What we count: url-safe base64 (no `/`, no `=`) and hex. Spaces, punctuation, slashes and
// newlines all break the run, so URLs and code paths don't trip the check — only a long opaque
// token glued to itself fires. Standard base64 with `+` and `/` is rare in modern tokens; URL-safe
// base64 has been the default for new credentials for years.
const RUN = /[A-Za-z0-9_-]{40,}/g;

// Known-safe shapes. A UUID is 36 chars of 4 bits/char (low entropy); a SHA-256 hex is 64 chars but
// fully hex, which the entropy check would flag — so we whitelist common hash lengths and ID
// formats explicitly. We only skip a *whole* run, not a partial match.
const SAFE: RegExp[] = [
  // UUID v1-5 with the standard 8-4-4-4-12 layout.
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  // Git SHA (7 to 40 hex chars) and full hex hashes (32 / 40 / 64 chars).
  /^[0-9a-f]{7,64}$/i,
  // ULID (26 chars, Crockford base32).
  /^[0-9A-HJKMNP-TV-Z]{26}$/,
  // Snowflake IDs (weft card ids are 18-20 digit numbers — too short to trigger anyway, but for
  // completeness we list the 18-digit form).
  /^[0-9]{18,20}$/,
];

function isSafe(run: string): boolean {
  for (const pattern of SAFE) if (pattern.test(run)) return true;
  return false;
}

// Shannon entropy of a string in bits per character, computed over the alphabet the run uses.
export function entropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const len = value.length;
  let bits = 0;
  for (const c of counts.values()) {
    const p = c / len;
    bits -= p * Math.log2(p);
  }
  return bits;
}

// The first opaque high-entropy run in `text`, or null. Walks left to right so we can replace it
// and re-call to find the next one.
export function findOpaqueToken(text: string): { value: string; index: number } | null {
  RUN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RUN.exec(text))) {
    const value = m[0];
    if (isSafe(value)) continue;
    if (entropy(value) >= MIN_ENTROPY) return { value, index: m.index };
  }
  return null;
}
