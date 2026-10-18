// lib/app-share-types.ts: the share-link contract for a mini app — the URL builder, the
// first-paint dialog state from the remembered memo, the iframe src the viewer frames, and the
// sha a blob share's page route serves. Pure, so a single import covers every branch.
import { describe, expect, it } from "vitest";
import { appBlobSha, appFrameSrc, appShareUrl, seedAppShareState } from "./app-share-types";
import type { CardShareMemo } from "./types-card-detail";
import type { MiniApp } from "./mini-apps";

const SHA = "a".repeat(64);

function makeApp(over: Partial<MiniApp> = {}): Pick<MiniApp, "url" | "share"> {
  return { url: "https://example.com/page", share: undefined, ...over };
}

describe("appShareUrl", () => {
  it("places the id under /a on weft.zip by default", () => {
    expect(appShareUrl("abc123")).toBe("https://weft.zip/a/abc123");
  });

  it("honours a custom origin", () => {
    expect(appShareUrl("abc", "http://localhost:3000")).toBe("http://localhost:3000/a/abc");
  });
});

describe("seedAppShareState", () => {
  it("returns signed-out for a signed-out visitor, even with a memo", () => {
    const memo: CardShareMemo = { id: "m1", mode: "public", hasPassword: false };
    expect(seedAppShareState(makeApp({ url: "file:///x.html", share: memo }), true)).toEqual({ kind: "signed-out" });
  });

  it("returns a private, no-link state for a file: app with no memo", () => {
    const state = seedAppShareState(makeApp({ url: "file:///Users/me/show/page.html" }), false);
    expect(state).toEqual({ kind: "ok", id: null, url: null, mode: "private", hasPassword: false, shows: "blob" });
  });

  it("returns a private, no-link state for an https app with no memo", () => {
    const state = seedAppShareState(makeApp({ url: "https://example.com/dash" }), false);
    expect(state).toEqual({ kind: "ok", id: null, url: null, mode: "private", hasPassword: false, shows: "site" });
  });

  it("hydrates a memo's id and url, keeping its mode and password flag", () => {
    const memo: CardShareMemo = { id: "m1", mode: "email", hasPassword: false };
    const state = seedAppShareState(makeApp({ url: "https://example.com/dash", share: memo }), false);
    expect(state).toEqual({ kind: "ok", id: "m1", url: "https://weft.zip/a/m1", mode: "email", hasPassword: false, shows: "site" });
  });

  it("hydrates a memo with no id (url stays null)", () => {
    const memo: CardShareMemo = { id: null, mode: "password", hasPassword: true };
    const state = seedAppShareState(makeApp({ url: "file:///x.html", share: memo }), false);
    expect(state).toEqual({ kind: "ok", id: null, url: null, mode: "password", hasPassword: true, shows: "blob" });
  });
});

describe("appFrameSrc", () => {
  it("frames a site share at its address", () => {
    expect(appFrameSrc("s1", { kind: "site", page: "https://example.com/dash" })).toBe("https://example.com/dash");
  });

  it("serves a blob share through the page route", () => {
    expect(appFrameSrc("s1", { kind: "blob", page: `blob:sha256:${SHA}` })).toBe(`/api/a/s1/page`);
  });

  it("keeps the #hash on a blob share so the page lands on the right anchor", () => {
    expect(appFrameSrc("s1", { kind: "blob", page: `blob:sha256:${SHA}#step-2` })).toBe(`/api/a/s1/page#step-2`);
  });
});

describe("appBlobSha", () => {
  it("returns the sha for a well-formed blob ref", () => {
    expect(appBlobSha({ kind: "blob", page: `blob:sha256:${SHA}` })).toBe(SHA);
  });

  it("strips a trailing #hash before validating the sha", () => {
    expect(appBlobSha({ kind: "blob", page: `blob:sha256:${SHA}#step-2` })).toBe(SHA);
  });

  it("returns null for a site share", () => {
    expect(appBlobSha({ kind: "site", page: "https://example.com/dash" })).toBeNull();
  });

  it("returns null for a blob ref that isn't 64 hex chars", () => {
    expect(appBlobSha({ kind: "blob", page: "blob:sha256:short" })).toBeNull();
    expect(appBlobSha({ kind: "blob", page: `blob:sha256:${"z".repeat(64)}` })).toBeNull();
  });

  it("returns null when the page doesn't even start with the blob prefix", () => {
    expect(appBlobSha({ kind: "blob", page: "https://example.com/dash" })).toBeNull();
  });
});
