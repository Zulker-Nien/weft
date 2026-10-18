// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mini } from "./show-rail";
import { FOLLOW_MS, usePaneFollow } from "./use-pane-follow";

const mini = (id: string, url: string, dot: Mini["dot"] = "ok"): Mini => ({ id, dot, text: id, at: 0, time: "", url });
const MINIS = [mini("p1", "http://a.test/", "page"), mini("t1", "http://a.test/"), mini("p2", "http://b.test/", "page"), mini("t5", "http://b.test/")];

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(pageUrl = "http://b.test/") {
  const reopen = vi.fn();
  const hook = renderHook(({ url }) => usePaneFollow(MINIS, url, reopen), { initialProps: { url: pageUrl } });
  const follow = (id: string, bottom = false) => act(() => hook.result.current(id, bottom));
  const wait = (ms = FOLLOW_MS) => act(() => vi.advanceTimersByTimeAsync(ms));
  return { reopen, hook, follow, wait };
}

describe("usePaneFollow", () => {
  it("takes the pane to the turn's page once the chat settles, and back to the newest at the end", async () => {
    const { reopen, hook, follow, wait } = setup();
    follow("t1");
    await wait(FOLLOW_MS - 1);
    expect(reopen).not.toHaveBeenCalled();
    await wait(1);
    expect(reopen).toHaveBeenCalledWith("http://a.test/");
    hook.rerender({ url: "http://a.test/" });
    follow("t5", true);
    await wait();
    expect(reopen).toHaveBeenLastCalledWith("http://b.test/");
  });

  it("leaves the pane alone at the end of the chat unless following moved it, or when it already shows the page", async () => {
    const { reopen, follow, wait } = setup("file:///starter.html");
    follow("t5", true);
    await wait();
    expect(reopen).not.toHaveBeenCalled();
    const already = setup();
    already.follow("t5");
    await already.wait();
    expect(already.reopen).not.toHaveBeenCalled();
  });

  it("only acts on where a fling stops, and not once unmounted", async () => {
    const { reopen, hook, follow, wait } = setup("http://c.test/");
    follow("t1");
    await wait(FOLLOW_MS / 2);
    follow("t5");
    await wait();
    expect(reopen.mock.calls).toEqual([["http://b.test/"]]);
    follow("t1");
    hook.unmount();
    await wait();
    expect(reopen).toHaveBeenCalledTimes(1);
  });
});
