import { describe, expect, it } from "vitest";
import { accountCallbackBody, extractErrorMessage, isAccountCallback } from "./account-link.cjs";
import { accountPage } from "../lib/account-page";

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

describe("extractErrorMessage", () => {
  it("gives the dialog the page's detail, decoded and without repeating the title", async () => {
    const res = accountPage("Couldn't sign in to Weft", "Unable to exchange external code: a49a & <retry>", false);
    expect(await extractErrorMessage(res)).toBe("Unable to exchange external code: a49a & <retry>");
  });

  it("falls back to the heading, then a stock line", async () => {
    expect(await extractErrorMessage(new Response("<h1>It&#39;s down</h1>"))).toBe("It's down");
    expect(await extractErrorMessage(new Response("<p></p>"))).toBe("Sign-in failed");
  });
});
