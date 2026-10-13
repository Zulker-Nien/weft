// lib/auth/next-path.ts: same-origin sanitizer for a `?next=` value.
// Mirrors the @aimhuge/auth package's `safeNextPath`; a plain `startsWith("/")`
// check misses `/\evil.com` because browsers parse that as `//evil.com`.
import { describe, expect, it } from "vitest";
import { safeNextPath } from "./next-path";

const FALLBACK = "/app";

describe("safeNextPath", () => {
  it("keeps a same-origin path", () => {
    expect(safeNextPath("/app", FALLBACK)).toBe("/app");
    expect(safeNextPath("/decks/123", FALLBACK)).toBe("/decks/123");
  });

  it("keeps a same-origin path with query and hash", () => {
    expect(safeNextPath("/app?tab=1#overview", FALLBACK)).toBe("/app?tab=1#overview");
  });

  it("falls back when the value is not a path", () => {
    expect(safeNextPath(null, FALLBACK)).toBe(FALLBACK);
    expect(safeNextPath(undefined, FALLBACK)).toBe(FALLBACK);
    expect(safeNextPath("", FALLBACK)).toBe(FALLBACK);
    expect(safeNextPath("https://evil.com/x", FALLBACK)).toBe(FALLBACK);
    expect(safeNextPath("javascript:alert(1)", FALLBACK)).toBe(FALLBACK);
  });

  it("rejects `//evil.com` (the open-redirect trick)", () => {
    expect(safeNextPath("//evil.com/x", FALLBACK)).toBe(FALLBACK);
  });

  it("rejects `/\\evil.com` (parsed by browsers as `//evil.com`)", () => {
    // `/\evil.com` is what a browser would parse as `//evil.com`; the sanitizer
    // resolves the value the way a browser would and rejects it. The
    // percent-encoded form (`/%5Cevil.com`) is a different URL — the slash and
    // backslash are both literal — and is allowed as a same-origin path; the
    // sanitizer's job is to refuse the trick, not every backslash.
    expect(safeNextPath("/\\evil.com", FALLBACK)).toBe(FALLBACK);
  });

  it("takes the first item when given an array (Next searchParams typing)", () => {
    expect(safeNextPath(["/app", "/other"], FALLBACK)).toBe("/app");
    expect(safeNextPath(["//evil.com"], FALLBACK)).toBe(FALLBACK);
  });
});
