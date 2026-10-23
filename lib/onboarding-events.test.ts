// @vitest-environment happy-dom
// lib/onboarding-events.ts: the window events the welcome sends the board. openNewThread/selectCard
// are the welcome's side (they dispatch); useOnboardingEvents is the board's side (it listens, stores
// the prompt as the New thread draft, and calls through). remember writes to localStorage, which
// happy-dom provides, so the draft is checked where it really lands.

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAFT } from "./new-thread";
import {
  OPEN_NEW_THREAD,
  openNewThread,
  SELECT_CARD,
  selectCard,
  useOnboardingEvents,
  type OpenNewThreadDetail,
} from "./onboarding-events";

beforeEach(() => localStorage.clear());

afterEach(() => cleanup());

// Listen directly, so the helpers are checked against the event names and detail the board listens for.
function capture(name: string) {
  const seen: unknown[] = [];
  const listener = (e: Event) => seen.push((e as CustomEvent).detail);
  window.addEventListener(name, listener);
  return { seen, done: () => window.removeEventListener(name, listener) };
}

describe("openNewThread", () => {
  it("dispatches OPEN_NEW_THREAD with the folder and prompt as its detail", () => {
    const { seen, done } = capture(OPEN_NEW_THREAD);
    openNewThread({ cwd: "/p/weft", prompt: "build a thing" });
    done();
    expect(OPEN_NEW_THREAD).toBe("weft:open-new-thread");
    expect(seen).toEqual([{ cwd: "/p/weft", prompt: "build a thing" }]);
  });

  it("dispatches with no folder or prompt when given an empty detail", () => {
    const { seen, done } = capture(OPEN_NEW_THREAD);
    openNewThread({});
    done();
    expect(seen).toEqual([{}]);
  });
});

describe("selectCard", () => {
  it("dispatches SELECT_CARD with the card id as its detail", () => {
    const { seen, done } = capture(SELECT_CARD);
    selectCard("card-7");
    done();
    expect(SELECT_CARD).toBe("weft:select-card");
    expect(seen).toEqual([{ id: "card-7" }]);
  });
});

describe("useOnboardingEvents", () => {
  it("opens New thread on the folder and stores the prompt as the draft", () => {
    const openNew = vi.fn();
    const select = vi.fn();
    renderHook(() => useOnboardingEvents(openNew, select));
    act(() => void openNewThread({ cwd: "/p/weft", prompt: "build a thing" }));
    expect(openNew).toHaveBeenCalledWith("/p/weft");
    expect(localStorage.getItem(DRAFT)).toBe("build a thing");
  });

  it("opens New thread with no folder when the detail has no cwd", () => {
    const openNew = vi.fn();
    renderHook(() => useOnboardingEvents(openNew, vi.fn()));
    act(() => void openNewThread({ prompt: "just a prompt" }));
    expect(openNew).toHaveBeenCalledWith(undefined);
    expect(localStorage.getItem(DRAFT)).toBe("just a prompt");
  });

  it("opens New thread without touching the draft when there is no prompt", () => {
    const openNew = vi.fn();
    renderHook(() => useOnboardingEvents(openNew, vi.fn()));
    act(() => void openNewThread({ cwd: "/p/other" }));
    expect(openNew).toHaveBeenCalledWith("/p/other");
    expect(localStorage.getItem(DRAFT)).toBeNull();
  });

  it("keeps an existing draft when a folder-only event arrives", () => {
    const openNew = vi.fn();
    renderHook(() => useOnboardingEvents(openNew, vi.fn()));
    act(() => void openNewThread({ prompt: "first prompt" }));
    act(() => void openNewThread({ cwd: "/p/other" }));
    expect(localStorage.getItem(DRAFT)).toBe("first prompt");
  });

  it("survives an event with no detail at all", () => {
    const openNew = vi.fn();
    renderHook(() => useOnboardingEvents(openNew, vi.fn()));
    act(() => void window.dispatchEvent(new CustomEvent(OPEN_NEW_THREAD)));
    act(() => void window.dispatchEvent(new CustomEvent(OPEN_NEW_THREAD, { detail: null })));
    expect(openNew).toHaveBeenCalledTimes(2);
    expect(openNew).toHaveBeenCalledWith(undefined);
    expect(localStorage.getItem(DRAFT)).toBeNull();
  });

  it("stores an empty-string prompt as a falsy one, so no draft is written", () => {
    const openNew = vi.fn();
    renderHook(() => useOnboardingEvents(openNew, vi.fn()));
    act(() => void openNewThread({ cwd: "/p", prompt: "" }));
    expect(openNew).toHaveBeenCalledWith("/p");
    expect(localStorage.getItem(DRAFT)).toBeNull();
  });

  it("selects the card the welcome just started", () => {
    const select = vi.fn();
    renderHook(() => useOnboardingEvents(vi.fn(), select));
    act(() => void selectCard("card-9"));
    expect(select).toHaveBeenCalledWith("card-9");
  });

  it("ignores a select event with no id", () => {
    const select = vi.fn();
    renderHook(() => useOnboardingEvents(vi.fn(), select));
    act(() => void window.dispatchEvent(new CustomEvent(SELECT_CARD)));
    act(() => void window.dispatchEvent(new CustomEvent(SELECT_CARD, { detail: null })));
    act(() => void window.dispatchEvent(new CustomEvent<{ id: string }>(SELECT_CARD, { detail: { id: "" } })));
    expect(select).not.toHaveBeenCalled();
  });

  it("stops listening after unmount", () => {
    const openNew = vi.fn();
    const select = vi.fn();
    const { unmount } = renderHook(() => useOnboardingEvents(openNew, select));
    unmount();
    act(() => void openNewThread({ cwd: "/p/weft", prompt: "too late" }));
    act(() => void selectCard("card-1"));
    expect(openNew).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(localStorage.getItem(DRAFT)).toBeNull();
  });

  it("re-subscribes with the new callbacks when they change", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ open }) => useOnboardingEvents(open, vi.fn()), {
      initialProps: { open: first },
    });
    rerender({ open: second });
    act(() => void openNewThread({ cwd: "/p/weft" }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("/p/weft");
  });

  it("does not double-listen after a re-render with the same callbacks", () => {
    const openNew = vi.fn();
    const select = vi.fn();
    const { rerender } = renderHook(() => useOnboardingEvents(openNew, select));
    rerender();
    act(() => void openNewThread({ cwd: "/p/weft" }));
    expect(openNew).toHaveBeenCalledTimes(1);
  });

  it("keeps the two listeners independent", () => {
    const openNew = vi.fn();
    const select = vi.fn();
    renderHook(() => useOnboardingEvents(openNew, select));
    act(() => void openNewThread({ cwd: "/p/weft" }));
    expect(select).not.toHaveBeenCalled();
    act(() => void selectCard("card-2"));
    expect(select).toHaveBeenCalledWith("card-2");
    expect(openNew).toHaveBeenCalledTimes(1);
  });

  it("types its detail as OpenNewThreadDetail", () => {
    // The exported type is what the welcome hands openNewThread; assert it round-trips.
    const detail: OpenNewThreadDetail = { cwd: "/p", prompt: "hi" };
    const { seen, done } = capture(OPEN_NEW_THREAD);
    openNewThread(detail);
    done();
    expect(seen).toEqual([detail]);
  });
});