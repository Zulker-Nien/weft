// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, Column } from "./types";

const apiMove = vi.fn<(id: string, column: Column) => Promise<unknown>>();
const apiMark = vi.fn<(id: string, patch: { tags?: string[] }) => Promise<unknown>>();
vi.mock("./client", () => ({ api: { move: (id: string, column: Column) => apiMove(id, column), mark: (id: string, patch: { tags?: string[] }) => apiMark(id, patch) } }));

const { useBoardCardActions } = await import("./use-board-card-actions");

const card = (over: Partial<Card> = {}): Card =>
  ({ id: "c1", title: "Fix", column: "running", cwd: "/repo", tags: [], archived: false, starred: false, ...over }) as Card;

beforeEach(() => {
  apiMove.mockReset();
  apiMark.mockReset();
  apiMove.mockResolvedValue({ card: card() });
  apiMark.mockResolvedValue({ card: card() });
});

afterEach(cleanup);

function makeActions(cards: Card[] = [card()]) {
  const setDragOver = vi.fn<(column: Column | null) => void>();
  const notify = vi.fn();
  const { result } = renderHook(() => useBoardCardActions({ cards, setDragOver, notify }));
  return { result, setDragOver, notify };
}

describe("useBoardCardActions", () => {
  it("move records an own move and calls api.move", () => {
    const { result } = makeActions();
    act(() => result.current.move("c1", "needs_you"));
    expect(apiMove).toHaveBeenCalledWith("c1", "needs_you");
    act(() => result.current.move("c1", "review"));
    expect(apiMove).toHaveBeenCalledWith("c1", "review");
  });

  it("move surfaces an api error through notify", async () => {
    apiMove.mockRejectedValueOnce(new Error("down"));
    const { result, notify } = makeActions();
    act(() => result.current.move("c1", "needs_you"));
    await Promise.resolve();
    expect(notify).toHaveBeenCalledWith(new Error("down"));
  });

  it("drop moves the dragged card when its column changed", () => {
    const preventDefault = vi.fn();
    const { result, setDragOver } = makeActions([card({ id: "c1", column: "running" })]);
    const event = { preventDefault, dataTransfer: { getData: () => "c1" } } as unknown as React.DragEvent;
    act(() => result.current.drop("needs_you", event));
    expect(preventDefault).toHaveBeenCalled();
    expect(setDragOver).toHaveBeenCalledWith(null);
    expect(apiMove).toHaveBeenCalledWith("c1", "needs_you");
  });

  it("drop leaves a card alone when it's already in the column", () => {
    const { result } = makeActions([card({ id: "c1", column: "needs_you" })]);
    const event = { preventDefault: vi.fn(), dataTransfer: { getData: () => "c1" } } as unknown as React.DragEvent;
    act(() => result.current.drop("needs_you", event));
    expect(apiMove).not.toHaveBeenCalled();
  });

  it("drop on an unknown id is a no-op (clears the drag state but doesn't move)", () => {
    const { result } = makeActions([]);
    const event = { preventDefault: vi.fn(), dataTransfer: { getData: () => "ghost" } } as unknown as React.DragEvent;
    act(() => result.current.drop("needs_you", event));
    expect(apiMove).not.toHaveBeenCalled();
  });

  it("tagCard adds the tag and saves it via api.mark", () => {
    const { result } = makeActions([card({ id: "c1", tags: ["bug"] })]);
    act(() => result.current.tagCard("c1", "urgent"));
    expect(apiMark).toHaveBeenCalledWith("c1", { tags: ["bug", "urgent"] });
  });

  it("tagCard is a no-op when the tag is already on the card", () => {
    const { result } = makeActions([card({ id: "c1", tags: ["bug"] })]);
    act(() => result.current.tagCard("c1", "bug"));
    expect(apiMark).not.toHaveBeenCalled();
  });

  it("tagCard is a no-op for an unknown card", () => {
    const { result } = makeActions([]);
    act(() => result.current.tagCard("ghost", "x"));
    expect(apiMark).not.toHaveBeenCalled();
  });
});
