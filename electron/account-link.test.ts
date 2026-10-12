import { describe, expect, it } from "vitest";
import { accountCallbackBody, isAccountCallback } from "./account-link.cjs";

describe("isAccountCallback", () => {
  it("matches weft://account-callback URLs only", () => {
    expect(isAccountCallback("weft://account-callback?code=abc")).toBe(true);
    expect(isAccountCallback("weft://account-callback")).toBe(true);
    expect(isAccountCallback("weft://card/123")).toBe(false);
    expect(isAccountCallback("weft://new?prompt=hi")).toBe(false);
    expect(isAccountCallback("https://example.com/x")).toBe(false);
    expect(isAccountCallback("not a url")).toBe(false);
  });
});

describe("accountCallbackBody", () => {
  it("returns the OAuth code on a success link", () => {
    expect(accountCallbackBody("weft://account-callback?code=c0de")).toEqual({ code: "c0de" });
  });

  it("returns the Supabase error fields on a failure link", () => {
    const body = accountCallbackBody("weft://account-callback?error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code%3A+c1df");
    expect(body).toEqual({
      error: "server_error",
      error_code: "unexpected_failure",
      error_description: "Unable to exchange external code: c1df",
    });
  });

  it("returns null for unrelated weft:// links and non-weft URLs", () => {
    expect(accountCallbackBody("weft://card/abc")).toBeNull();
    expect(accountCallbackBody("weft://new?prompt=hi")).toBeNull();
    expect(accountCallbackBody("https://example.com/")).toBeNull();
  });

  it("returns an empty object for a callback with no query string", () => {
    expect(accountCallbackBody("weft://account-callback")).toEqual({});
  });
});
