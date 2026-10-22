import { describe, expect, it } from "vitest";
import { NO_STORE, rateLimited, reject } from "./app-share-reply";

describe("reject", () => {
  it("answers the status in both the status line and the body, uncacheable", async () => {
    const res = reject(403, "no such share");
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ error: "no such share", status: 403 });
  });
});

describe("rateLimited", () => {
  it("is a 429 that tells the page how long to wait", async () => {
    const res = rateLimited(42);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ error: "rate limit exceeded", status: 429 });
  });

  it("takes the error when the route words its own", async () => {
    await expect(rateLimited(9, "Too many attempts.").json()).resolves.toEqual({ error: "Too many attempts.", status: 429 });
  });
});

describe("NO_STORE", () => {
  it("is the one uncacheable header every share reply sets", () => {
    expect(NO_STORE).toEqual({ "Cache-Control": "no-store" });
  });
});