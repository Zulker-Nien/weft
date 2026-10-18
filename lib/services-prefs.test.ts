// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REFRESH_MS,
  REFRESH_CHOICES,
  refreshLabel,
  servicesRefreshMs,
  setServicesRefreshMs,
  subscribeServicesRefresh,
} from "./services-prefs";

describe("REFRESH_CHOICES and DEFAULT_REFRESH_MS", () => {
  it("offers the documented choices and a 2s default", () => {
    expect([...REFRESH_CHOICES]).toEqual([1000, 2000, 5000, 10_000, 30_000, 0]);
    expect(DEFAULT_REFRESH_MS).toBe(2000);
  });
});

describe("refreshLabel", () => {
  it("labels seconds and the paused choice", () => {
    expect(refreshLabel(0)).toBe("paused");
    expect(refreshLabel(1000)).toBe("every 1s");
    expect(refreshLabel(5000)).toBe("every 5s");
    expect(refreshLabel(30_000)).toBe("every 30s");
  });
});

describe("servicesRefreshMs", () => {
  beforeEach(() => {
    document.cookie = "weft-services-refresh=; path=/; max-age=0";
  });

  it("falls back to the default when no cookie is set", () => {
    expect(servicesRefreshMs()).toBe(DEFAULT_REFRESH_MS);
  });

  it("reads a valid cookie value", () => {
    document.cookie = "weft-services-refresh=5000; path=/";
    expect(servicesRefreshMs()).toBe(5000);
  });

  it("returns 0 (paused) when the cookie says 0", () => {
    document.cookie = "weft-services-refresh=0; path=/";
    expect(servicesRefreshMs()).toBe(0);
  });

  it("falls back to the default for an off-list value", () => {
    document.cookie = "weft-services-refresh=1234; path=/";
    expect(servicesRefreshMs()).toBe(DEFAULT_REFRESH_MS);
  });

  it("ignores the cookie when it's not the only thing on its segment", () => {
    document.cookie = "weft-services-refresh=5000; path=/";
    document.cookie = "weft-other=10000; path=/";
    expect(servicesRefreshMs()).toBe(5000);
  });

  it("returns the default when document is undefined", () => {
    const origDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", { value: undefined, configurable: true });
    try {
      expect(servicesRefreshMs()).toBe(DEFAULT_REFRESH_MS);
    } finally {
      if (origDescriptor) Object.defineProperty(globalThis, "document", origDescriptor);
    }
  });
});

describe("setServicesRefreshMs", () => {
  it("writes the cookie and fires the event", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeServicesRefresh(listener);
    setServicesRefreshMs(10_000);
    expect(document.cookie).toMatch(/weft-services-refresh=10000/);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe("subscribeServicesRefresh", () => {
  it("stops calling the listener once unsubscribed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeServicesRefresh(listener);
    setServicesRefreshMs(1000);
    unsubscribe();
    setServicesRefreshMs(5000);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

afterEach(() => {
  document.cookie = "weft-services-refresh=; path=/; max-age=0";
});
