// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card, ThreadItem } from "./types";
import { useEditLast } from "./use-edit-last";

const edit = vi.fn(() => Promise.resolve());

const card = (over: Partial<Card> = {}) => ({ id: "c1", ...over }) as Card;
const items: ThreadItem[] = [
  { kind: "user", text: "one", at: 1, id: "p1" },
  { kind: "assistant", text: "ok", at: 2 },
  { kind: "user", text: "make it blue", at: 3, id: "p2" },
  { kind: "tool", id: "t", name: "Edit", summary: "a.ts", at: 4 },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useEditLast", () => {
  it("offers your last message, and marks it only while its card's box is editing", () => {
    const { result, rerender } = renderHook(({ c }) => useEditLast(c, items, edit, () => {}), { initialProps: { c: card() } });
    expect(result.current.editLast).toMatchObject({ text: "make it blue", canRewind: true, fileEdits: 1 });
    expect(result.current.editFrom).toBeUndefined();
    act(() => result.current.onEditing(true));
    expect(result.current.editFrom).toBe(2);
    rerender({ c: card({ id: "c2" }) });
    expect(result.current.editFrom).toBeUndefined();
    rerender({ c: card() });
    act(() => result.current.onEditing(false));
    expect(result.current.editFrom).toBeUndefined();
  });

  it("sends the edit through the transport, then calls back", async () => {
    const onEdited = vi.fn();
    const { result } = renderHook(() => useEditLast(card(), items, edit, onEdited));
    await act(() => result.current.editLast!.onEdit("make it red"));
    expect(edit).toHaveBeenCalledWith("c1", "make it red");
    expect(onEdited).toHaveBeenCalled();
  });

  it("marks nothing for a message that can't rewind", () => {
    const { result } = renderHook(() => useEditLast(card(), [{ kind: "user", text: "old", at: 1 }], edit, () => {}));
    act(() => result.current.onEditing(true));
    expect(result.current.editLast?.canRewind).toBe(false);
    expect(result.current.editFrom).toBeUndefined();
  });

  it("offers nothing on the copilot, before you've sent anything, or where the transport can't edit", () => {
    expect(renderHook(() => useEditLast(card({ role: "copilot" }), items, edit, () => {})).result.current.editLast).toBeUndefined();
    expect(renderHook(() => useEditLast(card(), [], edit, () => {})).result.current.editLast).toBeUndefined();
    expect(renderHook(() => useEditLast(card(), items, undefined, () => {})).result.current.editLast).toBeUndefined();
  });
});
