// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { OPEN_CARD_EVENT, onOpenCardRequest, openCardById } from "./open-card";

describe("open card events", () => {
  it("hands each requested id to the listener until it unsubscribes", () => {
    const handle = vi.fn();
    const off = onOpenCardRequest(handle);
    openCardById("a");
    window.dispatchEvent(new CustomEvent(OPEN_CARD_EVENT));
    off();
    openCardById("b");
    expect(handle.mock.calls).toEqual([["a"]]);
  });
});
