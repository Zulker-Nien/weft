// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardEvent } from "./types";
import { useBoardEvents } from "./use-events";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const event = { type: "card", card: { id: "c1" } } as unknown as BoardEvent;

describe("useBoardEvents", () => {
  it("opens one stream to /api/events", () => {
    renderHook(() => useBoardEvents(vi.fn(), vi.fn()));
    expect(FakeEventSource.instances.map((s) => s.url)).toEqual(["/api/events"]);
  });

  it("runs onOpen on every connect and reconnect", () => {
    const onOpen = vi.fn();
    renderHook(() => useBoardEvents(vi.fn(), onOpen));
    const [stream] = FakeEventSource.instances;
    stream.onopen?.();
    stream.onopen?.();
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("parses each message into a BoardEvent", () => {
    const onEvent = vi.fn();
    renderHook(() => useBoardEvents(onEvent, vi.fn()));
    FakeEventSource.instances[0].onmessage?.({ data: JSON.stringify(event) });
    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("calls the latest handlers without reopening the stream", () => {
    const first = { onEvent: vi.fn(), onOpen: vi.fn() };
    const second = { onEvent: vi.fn(), onOpen: vi.fn() };
    const { rerender } = renderHook((h) => useBoardEvents(h.onEvent, h.onOpen), { initialProps: first });
    rerender(second);
    const [stream] = FakeEventSource.instances;
    stream.onopen?.();
    stream.onmessage?.({ data: JSON.stringify(event) });
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(first.onOpen).not.toHaveBeenCalled();
    expect(first.onEvent).not.toHaveBeenCalled();
    expect(second.onOpen).toHaveBeenCalledOnce();
    expect(second.onEvent).toHaveBeenCalledWith(event);
  });

  it("closes the stream on unmount", () => {
    const { unmount } = renderHook(() => useBoardEvents(vi.fn(), vi.fn()));
    const [stream] = FakeEventSource.instances;
    expect(stream.close).not.toHaveBeenCalled();
    unmount();
    expect(stream.close).toHaveBeenCalledOnce();
  });
});
