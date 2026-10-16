// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filterHasFocus, focusFilter, jumpToNeedsYou, moveFocus, openFocused } from "./board-focus";
import type { Card, Column } from "./types";

afterEach(() => {
  document.body.innerHTML = "";
});

// Build a small board in the DOM: two columns, each with a card carrying data-card-id.
function renderBoard() {
  document.body.innerHTML = "";
  const make = (id: string, col: string) => {
    const colEl = document.createElement("section");
    colEl.dataset.column = col;
    const card = document.createElement("div");
    card.dataset.cardId = id;
    card.tabIndex = 0;
    colEl.appendChild(card);
    document.body.appendChild(colEl);
    return card;
  };
  return { c1: make("c1", "running"), c2: make("c2", "running"), n1: make("n1", "needs_you") };
}

describe("board-focus", () => {
  describe("filterHasFocus / focusFilter", () => {
    beforeEach(() => {
      const input = document.createElement("input");
      input.placeholder = "Filter cards";
      document.body.appendChild(input);
    });

    it("filterHasFocus is true only when the filter has focus", () => {
      const input = document.querySelector<HTMLInputElement>('input[placeholder="Filter cards"]')!;
      expect(filterHasFocus()).toBe(false);
      input.focus();
      expect(filterHasFocus()).toBe(true);
    });

    it("focusFilter focuses the input and selects its text", () => {
      const input = document.querySelector<HTMLInputElement>('input[placeholder="Filter cards"]')!;
      input.value = "hello";
      focusFilter();
      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(5);
    });
  });

  describe("moveFocus", () => {
    it("moves down within the current column", () => {
      const { c1, c2 } = renderBoard();
      const cols: { id: Column }[] = [{ id: "running" }, { id: "needs_you" }];
      c1.focus();
      moveFocus({ dy: 1 }, cols, "c1", "running");
      expect(document.activeElement).toBe(c2);
    });

    it("moves up to the previous card", () => {
      const { c1, c2 } = renderBoard();
      const cols: { id: Column }[] = [{ id: "running" }];
      c2.focus();
      moveFocus({ dy: -1 }, cols, "c2", "running");
      expect(document.activeElement).toBe(c1);
    });

    it("steps to the next column when moving right and skips empty ones", () => {
      const { c1, n1 } = renderBoard();
      const cols: { id: Column }[] = [{ id: "running" }, { id: "review" }, { id: "needs_you" }];
      c1.focus();
      moveFocus({ dx: 1 }, cols, "c1", "running");
      // "review" has no cards; "needs_you" does, so we land on it.
      expect(document.activeElement).toBe(n1);
    });

    it("stays put moving right past the last column with cards", () => {
      const { n1 } = renderBoard();
      const cols: { id: Column }[] = [{ id: "running" }, { id: "needs_you" }, { id: "review" }];
      n1.focus();
      moveFocus({ dx: 1 }, cols, "n1", "needs_you");
      expect(document.activeElement).toBe(n1);
    });

    it("jumps to first and last within a column", () => {
      const { c1, c2 } = renderBoard();
      const cols: { id: Column }[] = [{ id: "running" }];
      c2.focus();
      moveFocus({ edge: "first" }, cols, "c2", "running");
      expect(document.activeElement).toBe(c1);
      moveFocus({ edge: "last" }, cols, "c1", "running");
      expect(document.activeElement).toBe(c2);
    });

    it("with no focus, focuses the first card in the first non-empty column", () => {
      const { c1 } = renderBoard();
      const cols: { id: Column }[] = [{ id: "running" }];
      moveFocus({ dy: 1 }, cols, null, null);
      expect(document.activeElement).toBe(c1);
    });
  });

  describe("jumpToNeedsYou", () => {
    it("returns false when there is no card in needs_you", () => {
      renderBoard();
      expect(jumpToNeedsYou()).toBeFalsy();
    });

    it("focuses the first needs_you card when none has focus", () => {
      const { n1 } = renderBoard();
      jumpToNeedsYou();
      expect(document.activeElement).toBe(n1);
    });

    it("rotates through multiple needs_you cards", () => {
      document.body.innerHTML = "";
      const col = document.createElement("section");
      col.dataset.column = "needs_you";
      const a = document.createElement("div");
      a.dataset.cardId = "a";
      a.tabIndex = 0;
      const b = document.createElement("div");
      b.dataset.cardId = "b";
      b.tabIndex = 0;
      col.append(a, b);
      document.body.appendChild(col);

      a.focus();
      jumpToNeedsYou();
      expect(document.activeElement).toBe(b);
    });
  });

  describe("openFocused", () => {
    it("returns false when nothing is focused", () => {
      renderBoard();
      const openCard = vi.fn();
      const e = { key: "Enter" } as KeyboardEvent;
      expect(openFocused(e, [], openCard)).toBe(false);
      expect(openCard).not.toHaveBeenCalled();
    });

    it("opens the focused card", () => {
      const { c1 } = renderBoard();
      c1.focus();
      const card = { id: "c1" } as Card;
      const openCard = vi.fn();
      // The keyboard event's target is the focused card itself.
      const e = { key: "Enter", target: c1 } as unknown as KeyboardEvent;
      expect(openFocused(e, [card], openCard)).toBeUndefined();
      expect(openCard).toHaveBeenCalledWith(card);
    });

    it("refuses to open when Enter is pressed inside the card (e.g. on a button)", () => {
      const { c1 } = renderBoard();
      const button = document.createElement("button");
      c1.appendChild(button);
      button.focus();
      const card = { id: "c1" } as Card;
      const openCard = vi.fn();
      const e = { key: "Enter", target: button } as unknown as KeyboardEvent;
      expect(openFocused(e, [card], openCard)).toBe(false);
      expect(openCard).not.toHaveBeenCalled();
    });
  });
});
