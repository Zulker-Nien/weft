// Tests for the filled-URL re-check (electron/app-fetch-filled.cjs): after fillSecrets has
// swapped placeholders for values, verifyFilledUrl re-walks the URL and refuses any value
// that moved the request (host, port, userinfo) or landed on a path the rule didn't allow,
// or that introduces a percent-encoded slash/backslash/dot segment the server could decode.
// loggablePath is the helper routes use to log a plan's path without its query string, so a
// secret in the query never crosses a log line.

import { describe, expect, it } from "vitest";
import { fillSecrets, parsePolicy, planFetch, type ParsedPolicy } from "./app-fetch-policy.cjs";
import { verifyFilledUrl } from "./app-fetch-filled.cjs";
import { loggablePath } from "./app-fetch-run.cjs";

// The placeholder lives in the query string. The filled URL must be exactly what fetch sees,
// and verifyFilledUrl's only job is to say it's safe to send.
const stripePolicy: ParsedPolicy = parsePolicy({
  secrets: { STRIPE_KEY: { hosts: ["api.stripe.com"], methods: ["GET"], paths: ["/v1/charges"] } },
});
const stripeRequest = (url: string) => ({ url, method: "GET" as const, headers: { authorization: "Bearer {{secret:STRIPE_KEY}}" } });

describe("verifyFilledUrl", () => {
  it("returns the filled URL when the fill doesn't move the request", () => {
    const plan = planFetch(stripePolicy, stripeRequest("https://api.stripe.com/v1/charges?key={{secret:STRIPE_KEY}}"));
    const filled = fillSecrets(stripeRequest("https://api.stripe.com/v1/charges?key={{secret:STRIPE_KEY}}"), { STRIPE_KEY: "sk_live_xyz" });
    const result = verifyFilledUrl(plan, filled, stripePolicy);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.filledUrl).toBe("https://api.stripe.com/v1/charges?key=sk_live_xyz");
  });

  it("refuses when a value moves the request to a different host (403)", () => {
    const plan = planFetch(stripePolicy, stripeRequest("https://api.stripe.com/v1/charges?key={{secret:STRIPE_KEY}}"));
    const filled = { url: "https://evil.example.com/v1/charges?key=sk_live_xyz", method: "GET" as const, headers: {} };
    const result = verifyFilledUrl(plan, filled, stripePolicy);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toMatch(/moved the request to host/i);
    }
  });

  it("refuses when a value adds userinfo to the URL (400)", () => {
    const plan = planFetch(stripePolicy, stripeRequest("https://api.stripe.com/v1/charges?key={{secret:STRIPE_KEY}}"));
    // A value that, when filled, lands in the URL's user position. planFetch only saw the
    // planned URL so it didn't catch this; verifyFilledUrl walks the filled URL and refuses.
    const filledSneaky = { url: "https://user@api.stripe.com/v1/charges?key=sk_live_xyz", method: "GET" as const, headers: {} };
    const result = verifyFilledUrl(plan, filledSneaky, stripePolicy);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/credentials/i);
    }
  });

  it("refuses when a value moves the port (403)", () => {
    const plan = planFetch(stripePolicy, stripeRequest("https://api.stripe.com/v1/charges?key={{secret:STRIPE_KEY}}"));
    const filled = { url: "https://api.stripe.com:8443/v1/charges?key=sk_live_xyz", method: "GET" as const, headers: {} };
    const result = verifyFilledUrl(plan, filled, stripePolicy);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toMatch(/port/i);
    }
  });

  it("refuses when the filled path no longer matches the secret's prefix (403)", () => {
    // The planned URL puts the placeholder in the query and is allowed by the rule. The
    // filled URL the test simulates points at a different path (a value that broke out of
    // the rule's prefix). planFetch's prefix-only check used to allow this; verifyFilledUrl
    // re-runs the rule against the filled path and refuses.
    const plan = planFetch(stripePolicy, { url: "https://api.stripe.com/v1/charges?key={{secret:STRIPE_KEY}}", method: "GET", headers: {} });
    const filled = { url: "https://api.stripe.com/v2/anything", method: "GET" as const, headers: {} };
    const result = verifyFilledUrl(plan, filled, stripePolicy);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toContain("STRIPE_KEY");
      expect(result.error).toMatch(/path/i);
    }
  });

  it("refuses a planned URL with %2f anywhere in the path (400)", () => {
    // Build a request whose planned URL has %2f in the pathname; planFetch encodes `?key=`
    // already but a percent-encoded slash gets through if the user wrote one explicitly.
    const plan = { ok: true as const, url: "https://api.stripe.com/v1%2fcharges?key=", method: "GET", names: [] as string[] };
    const filled = { url: "https://api.stripe.com/v1%2fcharges", method: "GET" as const, headers: {} };
    const result = verifyFilledUrl(plan, filled, stripePolicy);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/%2f|%5c|%2e/);
    }
  });

  it("refuses a planned URL with %2F (uppercase) (400)", () => {
    const plan = { ok: true as const, url: "https://api.stripe.com/v1%2Fcharges?key=", method: "GET", names: [] as string[] };
    const filled = { url: "https://api.stripe.com/v1%2Fcharges", method: "GET" as const, headers: {} };
    const result = verifyFilledUrl(plan, filled, stripePolicy);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("refuses a planned URL with %5c (400)", () => {
    const plan = { ok: true as const, url: "https://api.stripe.com/v1%5ccharges?key=", method: "GET", names: [] as string[] };
    const filled = { url: "https://api.stripe.com/v1%5ccharges", method: "GET" as const, headers: {} };
    const result = verifyFilledUrl(plan, filled, stripePolicy);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("refuses a planned URL with %2e (400)", () => {
    const plan = { ok: true as const, url: "https://api.stripe.com/v1%2echarges?key=", method: "GET", names: [] as string[] };
    const filled = { url: "https://api.stripe.com/v1%2echarges", method: "GET" as const, headers: {} };
    const result = verifyFilledUrl(plan, filled, stripePolicy);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("refuses when a value brings %2f into the filled URL path (400)", () => {
    const plan = planFetch(stripePolicy, { url: "https://api.stripe.com/v1/charges?key={{secret:STRIPE_KEY}}", method: "GET", headers: {} });
    // The placeholder sat in the query, but the value contains a percent-encoded slash that
    // lands in the path of the URL the test simulates (so the server could decode it).
    const filled = { url: "https://api.stripe.com/v1/char%2fges", method: "GET" as const, headers: {} };
    const result = verifyFilledUrl(plan, filled, stripePolicy);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("allows a normal URL with no escapes", () => {
    const plan = planFetch(stripePolicy, stripeRequest("https://api.stripe.com/v1/charges?key={{secret:STRIPE_KEY}}"));
    const filled = fillSecrets(stripeRequest("https://api.stripe.com/v1/charges?key={{secret:STRIPE_KEY}}"), { STRIPE_KEY: "sk_live_xyz" });
    const result = verifyFilledUrl(plan, filled, stripePolicy);
    expect(result.ok).toBe(true);
  });
});

describe("loggablePath", () => {
  it("returns the planned path with the query stripped", () => {
    const p = planFetch(parsePolicy({ secrets: { X: { hosts: ["example.com"], methods: ["GET"], paths: ["/v1/"] } } }), { url: "https://example.com/v1/charges?limit=10&secret={{secret:X}}", method: "GET" });
    expect(loggablePath(p)).toBe("/v1/charges");
  });

  it("returns an empty string for a refused plan", () => {
    expect(loggablePath(null)).toBe("");
    const refused = { ok: false as const, status: 400 as const, error: "url is missing." };
    expect(loggablePath(refused)).toBe("");
  });

  it("returns '/' when the path is empty", () => {
    const p = { ok: true as const, url: "https://example.com/", method: "GET", names: [] as string[] };
    expect(loggablePath(p)).toBe("/");
  });
});