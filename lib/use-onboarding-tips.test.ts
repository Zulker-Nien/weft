// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { markSeen, resetTips, TIPS_CHANGED, TIPS_KEY } from "./tips";
import type { Card } from "./types";
import { useOnboardingTips } from "./use-onboarding-tips";

const card = (column: Card["column"], over: Partial<Card> = {}) => ({ id: column, column, ...over }) as Card;

describe("useOnboardingTips", () => {
  beforeEach(() => localStorage.clear());

  it("shows the start panel on a loaded, empty, unfiltered board", () => {
    expect(renderHook(() => useOnboardingTips([], true, false)).result.current).toMatchObject({ tip: null, empty: true });
    expect(renderHook(() => useOnboardingTips([card("done", { archived: true }), card("running", { role: "copilot" })], true, false)).result.current.empty).toBe(true);
    expect(renderHook(() => useOnboardingTips([], false, false)).result.current.empty).toBe(false);
    expect(renderHook(() => useOnboardingTips([], true, true)).result.current.empty).toBe(false);
  });

  it("walks the tips as Got it marks each one seen", () => {
    const { result } = renderHook(() => useOnboardingTips([card("needs_you"), card("review")], true, false));
    expect(result.current).toMatchObject({ tip: "needs-you", empty: false });
    act(() => result.current.dismiss("needs-you"));
    expect(result.current.tip).toBe("review");
    expect(localStorage.getItem(TIPS_KEY)).toBe('["needs-you"]');
  });

  it("hears Reset tips from Settings", () => {
    markSeen("profile");
    const { result } = renderHook(() => useOnboardingTips([card("done")], true, false));
    expect(result.current.tip).toBeNull();
    act(() => {
      resetTips();
      window.dispatchEvent(new Event(TIPS_CHANGED));
    });
    expect(result.current.tip).toBe("profile");
  });

  it("treats blocked storage as nothing seen", () => {
    const spy = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(renderHook(() => useOnboardingTips([card("review")], true, false)).result.current.tip).toBe("review");
    spy.mockRestore();
  });

  it("shows nothing on the server", () => {
    function Probe() {
      const { tip, empty } = useOnboardingTips([card("review")], true, false);
      return createElement("i", null, `${tip}-${empty}`);
    }
    expect(renderToString(createElement(Probe))).toContain("null-false");
  });
});
