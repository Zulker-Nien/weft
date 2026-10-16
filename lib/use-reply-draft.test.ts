// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { replyDraftKey } from "@/lib/drafts";
import { useReplyDraft } from "./use-reply-draft";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useReplyDraft", () => {
  it("returns the stored draft as initial", () => {
    localStorage.setItem(replyDraftKey("c1"), "half a thought");
    const { result } = renderHook(() => useReplyDraft("c1", undefined, () => {}));
    expect(result.current.initial).toBe("half a thought");
  });

  it("debounces saves and writes after 300ms", () => {
    const { result } = renderHook(() => useReplyDraft("c1", undefined, () => {}));
    act(() => result.current.save("hello"));
    expect(localStorage.getItem(replyDraftKey("c1"))).toBeNull();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(localStorage.getItem(replyDraftKey("c1"))).toBe("hello");
  });

  it("writes immediately when now is true", () => {
    const { result } = renderHook(() => useReplyDraft("c1", undefined, () => {}));
    act(() => result.current.save("ship it", true));
    expect(localStorage.getItem(replyDraftKey("c1"))).toBe("ship it");
  });

  it("detects a leading ! when onShell is given", () => {
    const { result } = renderHook(() => useReplyDraft("c1", () => Promise.resolve(), () => {}));
    expect(result.current.shell).toBe(false);
    act(() => result.current.save("!ls"));
    expect(result.current.shell).toBe(true);
  });

  it("leaves shell false when onShell is missing (the copilot)", () => {
    const { result } = renderHook(() => useReplyDraft("c1", undefined, () => {}));
    act(() => result.current.save("!ls"));
    expect(result.current.shell).toBe(false);
  });
});