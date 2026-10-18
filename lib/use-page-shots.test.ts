// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ call: vi.fn<(method: string, url: string, body?: unknown) => Promise<unknown>>() }));
vi.mock("./client-api", () => ({ call: h.call }));

const { SETTLE_MS, usePageShots } = await import("./use-page-shots");

const A = { "http://a.test/": "/api/cards/c1/shots?img=a&v=1" };

beforeEach(() => {
  vi.useFakeTimers();
  h.call.mockReset();
});
afterEach(() => vi.useRealTimers());

const settle = () => act(() => vi.advanceTimersByTimeAsync(SETTLE_MS));
type Props = { card?: string; url: string; items: number };
const hook = (initialProps: Props) => renderHook(({ card, url, items }: Props) => usePageShots(card, url, items), { initialProps });

describe("usePageShots", () => {
  it("captures the page once it settles and returns the card's pictures", async () => {
    h.call.mockResolvedValue({ shots: A });
    const { result, rerender } = hook({ card: "c1", url: "http://a.test/", items: 3 });
    expect(result.current).toEqual({});
    await settle();
    expect(h.call).toHaveBeenCalledWith("POST", "/api/cards/c1/shots", { url: "http://a.test/" });
    expect(result.current).toEqual(A);
    // A turn that moved on captures the page again.
    rerender({ card: "c1", url: "http://a.test/", items: 4 });
    await settle();
    expect(h.call).toHaveBeenCalledTimes(2);
  });

  it("only reads the list for a blank pane, asks nothing with no card, and shows another card's pictures as none", async () => {
    h.call.mockResolvedValue({ shots: A });
    const { result, rerender } = hook({ card: "c1", url: "about:blank", items: 0 });
    await settle();
    expect(h.call).toHaveBeenCalledWith("GET", "/api/cards/c1/shots");
    expect(result.current).toEqual(A);
    rerender({ card: "c2", url: "", items: 0 });
    expect(result.current).toEqual({});
    h.call.mockClear();
    rerender({ url: "http://a.test/", items: 0 });
    await settle();
    expect(h.call).not.toHaveBeenCalled();
  });

  it("waits out a page that changes before it settles, and shrugs off a failed request", async () => {
    h.call.mockRejectedValue(new Error("offline"));
    const { result, rerender } = hook({ card: "c1", url: "http://a.test/", items: 0 });
    await act(() => vi.advanceTimersByTimeAsync(SETTLE_MS / 2));
    rerender({ card: "c1", url: "http://b.test/", items: 0 });
    await settle();
    expect(h.call.mock.calls).toEqual([["POST", "/api/cards/c1/shots", { url: "http://b.test/" }]]);
    expect(result.current).toEqual({});
  });
});
