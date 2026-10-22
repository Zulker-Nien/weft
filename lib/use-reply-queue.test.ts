// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useReplyQueue, type ReplyQueueOptions } from "./use-reply-queue";

function setup(more: Partial<ReplyQueueOptions> = {}) {
  const opts: ReplyQueueOptions = {
    live: true,
    busy: false,
    onSend: vi.fn(() => Promise.resolve()),
    onStop: vi.fn(() => Promise.resolve()),
    onSent: vi.fn(),
    onError: vi.fn(),
    ...more,
  };
  const hook = renderHook((p: Partial<ReplyQueueOptions>) => useReplyQueue({ ...opts, ...p }), { initialProps: {} });
  return { ...hook, opts };
}

describe("useReplyQueue", () => {
  it("holds replies while the turn runs and sends them as one message, once, when it ends", async () => {
    const { result, rerender, opts } = setup();
    act(() => result.current.add("a"));
    act(() => result.current.add("b"));
    expect(result.current.queue).toEqual(["a", "b"]);
    rerender({ live: false });
    rerender({ live: false });
    await waitFor(() => expect(opts.onSent).toHaveBeenCalledOnce());
    expect(opts.onSend).toHaveBeenCalledExactlyOnceWith("a\n\nb");
    expect(result.current.queue).toEqual([]);
  });

  it("sends a batch once even when StrictMode runs its effect twice", async () => {
    const onSend = vi.fn(() => Promise.resolve());
    const { result, rerender } = renderHook(
      (p: { live: boolean }) => useReplyQueue({ live: p.live, busy: false, onSend, onStop: vi.fn(), onSent: vi.fn(), onError: vi.fn() }),
      { initialProps: { live: true }, reactStrictMode: true },
    );
    act(() => result.current.add("a"));
    rerender({ live: false });
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("holds the rest while sendNow is out, even if the turn ends meanwhile", async () => {
    let finish = () => {};
    const onSend = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const { result, rerender } = setup({ onSend });
    act(() => result.current.add("a"));
    act(() => result.current.add("b"));
    let pending!: Promise<void>;
    act(() => void (pending = result.current.sendNow(1)));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("b"));
    rerender({ live: false });
    expect(onSend).toHaveBeenCalledOnce();
    await act(async () => (finish(), pending));
    await waitFor(() => expect(onSend).toHaveBeenLastCalledWith("a"));
  });

  it("puts a failed batch back on hold, and resume lets it go again", async () => {
    const onSend = vi.fn<(t: string) => Promise<void>>().mockRejectedValueOnce(new Error("gone")).mockResolvedValue();
    const { result, rerender, opts } = setup({ onSend });
    act(() => result.current.add("a"));
    rerender({ live: false });
    await waitFor(() => expect(opts.onError).toHaveBeenCalledWith(new Error("gone")));
    expect(result.current.queue).toEqual(["a"]);
    expect(result.current.paused).toBe(true);
    act(() => result.current.resume());
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    expect(result.current.paused).toBe(false);
  });

  it("doesn't send while paused, and remove drops a message", () => {
    const { result, rerender, opts } = setup();
    act(() => result.current.add("a"));
    act(() => result.current.add("b"));
    act(() => result.current.setPaused(true));
    act(() => result.current.remove(0));
    rerender({ live: false });
    expect(opts.onSend).not.toHaveBeenCalled();
    expect(result.current.queue).toEqual(["b"]);
  });

  it("sendNow stops the turn and sends one message, leaving the rest", async () => {
    const { result, opts } = setup();
    act(() => result.current.add("a"));
    act(() => result.current.add("b"));
    await act(() => result.current.sendNow(1));
    expect(opts.onStop).toHaveBeenCalledOnce();
    expect(opts.onSend).toHaveBeenCalledExactlyOnceWith("b");
    expect(opts.onSent).toHaveBeenCalledOnce();
    expect(result.current).toMatchObject({ queue: ["a"], paused: false, sending: false });
  });

  it("sendNow with no index sends the whole queue, without a stop once idle", async () => {
    const { result, rerender, opts } = setup();
    act(() => result.current.add("a"));
    act(() => result.current.setPaused(true));
    rerender({ live: false });
    await act(() => result.current.sendNow());
    expect(opts.onStop).not.toHaveBeenCalled();
    expect(opts.onSend).toHaveBeenCalledExactlyOnceWith("a");
    expect(result.current.queue).toEqual([]);
  });

  it("a failed sendNow puts the message back first", async () => {
    const onSend = vi.fn<(t: string) => Promise<void>>().mockRejectedValue(new Error("offline"));
    const { result, opts } = setup({ onSend });
    act(() => result.current.add("a"));
    act(() => result.current.add("b"));
    await act(() => result.current.sendNow(1));
    expect(opts.onError).toHaveBeenCalledWith(new Error("offline"));
    expect(result.current.queue).toEqual(["b", "a"]);
    expect(result.current.sending).toBe(false);
  });

  it("sendNow does nothing while another send is out or for a missing row", async () => {
    const { result, rerender, opts } = setup();
    act(() => result.current.add("a"));
    await act(() => result.current.sendNow(5));
    rerender({ busy: true });
    await act(() => result.current.sendNow(0));
    expect(opts.onSend).not.toHaveBeenCalled();

    let finish = () => {};
    const slow = vi.fn(() => new Promise<void>((r) => (finish = r)));
    rerender({ busy: false, onSend: slow });
    let first!: Promise<void>;
    act(() => void (first = result.current.sendNow(0)));
    await waitFor(() => expect(result.current.sending).toBe(true));
    await act(() => result.current.sendNow());
    await act(async () => (finish(), first));
    expect(slow).toHaveBeenCalledOnce();
  });
});
