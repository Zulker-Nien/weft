// @vitest-environment jsdom
// lib/auth/desktop.ts: the Electron shell bridge. Verifies the redirect target
// for the packaged app (weft://) and plain `next dev` (loopback), and the
// isDesktop / openExternal shims.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authRedirectTo, isDesktop, openExternal } from "./desktop";

describe("authRedirectTo", () => {
  const originalShell = process.env.WEFT_SHELL_URL;

  afterEach(() => {
    if (originalShell === undefined) delete process.env.WEFT_SHELL_URL;
    else process.env.WEFT_SHELL_URL = originalShell;
  });

  it("returns the weft:// URL when the Electron shell is running", () => {
    process.env.WEFT_SHELL_URL = "http://127.0.0.1:7373";
    const url = authRedirectTo("/app");
    expect(url.startsWith("weft://account-callback?next=")).toBe(true);
    expect(url).toContain(encodeURIComponent("/app"));
  });

  it("falls back to the loopback origin in plain `next dev`", () => {
    delete process.env.WEFT_SHELL_URL;
    const url = authRedirectTo("/app", "http://127.0.0.1:1000");
    expect(url).toBe("http://127.0.0.1:1000/api/auth/callback?next=%2Fapp");
  });

  it("trims trailing slashes on the loopback origin", () => {
    delete process.env.WEFT_SHELL_URL;
    expect(authRedirectTo("/app", "http://127.0.0.1:1000///")).toBe(
      "http://127.0.0.1:1000/api/auth/callback?next=%2Fapp",
    );
  });
});

describe("isDesktop", () => {
  beforeEach(() => {
    delete (window as unknown as { weft?: unknown }).weft;
  });

  it("is false in a normal browser tab", () => {
    expect(isDesktop()).toBe(false);
  });

  it("is true when window.weft is set (Electron preload ran)", () => {
    (window as unknown as { weft: object }).weft = {};
    expect(isDesktop()).toBe(true);
  });
});

describe("openExternal", () => {
  let open: ReturnType<typeof vi.fn>;
  // Captured via a string-keyed lookup so the unbound-method rule doesn't fire
  // on `window.open` (it's a method-shaped function on the window object).
  const OPEN = "open" as const;
  let savedOpen: ((...args: Parameters<typeof window.open>) => ReturnType<typeof window.open>) | undefined;

  beforeEach(() => {
    delete (window as unknown as { weft?: { openExternal?: (u: string) => void } }).weft;
    open = vi.fn();
    savedOpen = (window as unknown as Record<typeof OPEN, typeof savedOpen>)[OPEN];
    Object.defineProperty(window, OPEN, { configurable: true, value: open });
  });

  afterEach(() => {
    Object.defineProperty(window, OPEN, { configurable: true, value: savedOpen });
  });

  it("uses the shell's openExternal when present", () => {
    (window as unknown as { weft: { openExternal: (u: string) => void } }).weft = {
      openExternal: open as unknown as (u: string) => void,
    };
    openExternal("https://github.com/login/oauth/authorize?...");
    expect(open).toHaveBeenCalledWith("https://github.com/login/oauth/authorize?...");
  });

  it("falls back to window.open in a normal browser tab", () => {
    openExternal("https://github.com/login/oauth/authorize");
    expect(open).toHaveBeenCalledWith("https://github.com/login/oauth/authorize", "_blank", "noopener,noreferrer");
  });
});
