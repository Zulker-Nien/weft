// electron/browser-pane.cjs: the origin policy the L-5 fix introduces. The helpers are pure
// functions of the (keyed) authorized Map and the call's inputs, so the tests cover the gates
// without standing up the pane's webContentsView.
import { describe, expect, it } from "vitest";
import { canThreadOpen, rememberBoardOrigin } from "./pane-origins.cjs";

describe("canThreadOpen", () => {
  it("allows null-origin URLs (file:, about:)", () => {
    expect(canThreadOpen(new Map(), "k", null, "https://x")).toBe(true);
    expect(canThreadOpen(new Map(), "k", "null", "https://x")).toBe(true);
  });

  it("allows the first load (no prior origin) — board's restore call", () => {
    expect(canThreadOpen(new Map(), "k", "https://x", null)).toBe(true);
  });

  it("allows same-origin navigation", () => {
    expect(canThreadOpen(new Map(), "k", "https://x", "https://x")).toBe(true);
  });

  it("denies a fresh host a thread hasn't been authorized to navigate", () => {
    expect(canThreadOpen(new Map(), "k", "https://other", "https://x")).toBe(false);
  });

  it("allows a host the board explicitly opened", () => {
    const auth = new Map<string, Set<string>>();
    rememberBoardOrigin(auth, "k", "https://other");
    expect(canThreadOpen(auth, "k", "https://other", "https://x")).toBe(true);
  });

  it("scopes authorization per pane key", () => {
    const auth = new Map<string, Set<string>>();
    rememberBoardOrigin(auth, "a", "https://other");
    expect(canThreadOpen(auth, "b", "https://other", "https://x")).toBe(false);
  });
});

describe("rememberBoardOrigin", () => {
  it("is a no-op for null origins", () => {
    const auth = new Map<string, Set<string>>();
    rememberBoardOrigin(auth, "k", null);
    rememberBoardOrigin(auth, "k", "null");
    expect(auth.size).toBe(0);
  });

  it("adds the origin to the pane key's set", () => {
    const auth = new Map<string, Set<string>>();
    rememberBoardOrigin(auth, "k", "https://a");
    rememberBoardOrigin(auth, "k", "https://b");
    expect(auth.get("k")?.has("https://a")).toBe(true);
    expect(auth.get("k")?.has("https://b")).toBe(true);
  });
});
