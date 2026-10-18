// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { onScrollToTurn, onTopTurn, pulse, reportTopTurn, scrollToTurn, topmostTurn, turnRow } from "./show-events";

const box = (top: number, bottom: number) => () => ({ top, bottom }) as DOMRect;

describe("show events", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("carries a turn id from scrollToTurn and reportTopTurn to their listeners, until unsubscribed", () => {
    const scrolled = vi.fn();
    const topped = vi.fn();
    const offScroll = onScrollToTurn(scrolled);
    const offTop = onTopTurn(topped);
    scrollToTurn("t3");
    reportTopTurn("t5");
    expect(scrolled).toHaveBeenCalledWith("t3");
    expect(topped).toHaveBeenCalledWith("t5");
    offScroll();
    offTop();
    scrollToTurn("t4");
    reportTopTurn("t6");
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(topped).toHaveBeenCalledTimes(1);
  });

  it("finds the first row still showing at the scroller's top, and a row by id", () => {
    const scroller = document.createElement("div");
    scroller.innerHTML = `<div data-turn="t0"></div><div data-turn="t2"></div>`;
    const [first, second] = scroller.querySelectorAll<HTMLElement>("[data-turn]");
    scroller.getBoundingClientRect = box(100, 500);
    first!.getBoundingClientRect = box(0, 100);
    second!.getBoundingClientRect = box(100, 300);
    expect(topmostTurn(scroller)).toBe("t2");
    second!.getBoundingClientRect = box(0, 50);
    expect(topmostTurn(scroller)).toBeUndefined();
    expect(turnRow(scroller, "t2")).toBe(second);
  });

  it("pulses an element, and nothing when there's none", () => {
    const animate = vi.fn();
    pulse({ animate } as unknown as Element);
    expect(animate).toHaveBeenCalledOnce();
    expect(() => pulse(null)).not.toThrow();
  });
});
