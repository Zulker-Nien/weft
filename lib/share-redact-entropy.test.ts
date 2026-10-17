// lib/share-redact-entropy.ts: the high-entropy opaque-token detector the share redactor's second
// pass uses to catch a custom key shape the lib/secret-detect.ts patterns don't know. The
// detector fires on long URL-safe base64 / hex runs; the whitelist keeps UUIDs, hex hashes, and
// common ID formats from being flagged. This file exercises the entropy math, the whitelist, and
// the search loop end to end.
import { describe, expect, it } from "vitest";
import { entropy, findOpaqueToken } from "./share-redact-entropy";

describe("entropy", () => {
  it("is 0 for an empty string", () => {
    expect(entropy("")).toBe(0);
  });

  it("is low for a single repeated character", () => {
    expect(entropy("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBeLessThan(0.1);
  });

  it("is high for a uniform random run", () => {
    // 64 random-ish alphanumerics — Shannon entropy should be at or above log2(36) ≈ 5.17.
    const text = "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz01";
    expect(entropy(text)).toBeGreaterThanOrEqual(5.0);
  });

  it("is moderate for English-like text", () => {
    // Even with no spaces, English characters top out around 4.5 bits/char.
    const text = "thequickbrownfoxjumpsoverthelazydogthequickbrownfoxjumpsover";
    expect(entropy(text)).toBeLessThan(4.5);
  });
});

describe("findOpaqueToken", () => {
  it("returns null for ordinary prose", () => {
    expect(findOpaqueToken("hello world, this is some plain text")).toBeNull();
  });

  it("returns null for a URL path (slashes break the run)", () => {
    expect(findOpaqueToken("https://example.com/some/path/to/endpoint?query=value")).toBeNull();
  });

  it("flags a 40+ char high-entropy token", () => {
    const token = "Qx9zT3vKfL2mY8wRjP5cE7nB4hG1aDsUo6iW0eTrYlA"; // gitleaks:allow
    const out = findOpaqueToken(`prefix ${token} suffix`);
    expect(out?.value).toBe(token);
    expect(out?.index).toBe(7);
  });

  it("skips a UUID even at 36 chars", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    // The run is `550e8400-e29b-41d4-a716-446655440000` — 36 chars of mostly hex with dashes; the
    // dashes break the run into shorter pieces anyway, so even without the whitelist the detector
    // would miss it. The whitelist is a belt-and-braces guarantee.
    expect(findOpaqueToken(`id ${uuid} end`)).toBeNull();
  });

  it("skips a 64-char hex hash", () => {
    const hash = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    expect(findOpaqueToken(`sha256 ${hash}`)).toBeNull();
  });

  it("skips a 40-char hex git SHA", () => {
    const sha = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b";
    expect(findOpaqueToken(`commit ${sha}`)).toBeNull();
  });

  it("does not flag a long run of repeated characters", () => {
    expect(findOpaqueToken("a".repeat(60))).toBeNull();
  });

  it("does not flag a long run of dashes and underscores (no alphabet diversity)", () => {
    expect(findOpaqueToken("-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-")).toBeNull();
  });

  it("returns the first match when several appear in the same text", () => {
    const a = "Qx9zT3vKfL2mY8wRjP5cE7nB4hG1aDsUo6iW0eTrYlA"; // gitleaks:allow
    const b = "Zy8xW0vBnM3qLpK2jRfT6cE7oH4gDsAu5iW9eTrYlB"; // gitleaks:allow
    const out = findOpaqueToken(`first ${a} then ${b}`);
    expect(out?.value).toBe(a);
  });
});
