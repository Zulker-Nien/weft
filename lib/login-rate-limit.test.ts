// Tiny stand-alone test for isRateLimitError (lives in lib/login.ts). Pulled into its own file so
// the larger lib/login.test.ts can stay at its lint ceiling.
import { describe, expect, it } from "vitest";
import { isRateLimitError } from "./login";

describe("isRateLimitError", () => {
  it.each(["hit your limit for the 5-hour window", "rate limit reached", "Usage limit exceeded"])("matches %j", (text) => {
    expect(isRateLimitError(text)).toBe(true);
  });
  it.each(["not logged in", "network timeout", ""])("ignores %j", (text) => {
    expect(isRateLimitError(text)).toBe(false);
  });
});