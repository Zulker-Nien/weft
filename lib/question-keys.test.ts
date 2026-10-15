import { describe, expect, it } from "vitest";
import { initialAnswers } from "./question-answers";
import { keyAction } from "./question-keys";
import type { Question } from "./types";

const ONE: Question[] = [{ question: "Which?", options: [{ label: "A" }, { label: "B" }] }];
const TWO: Question[] = [{ question: "Tick?", multiSelect: true, options: [{ label: "X" }, { label: "Y" }] }, ...ONE];

const press = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("keyAction", () => {
  it("leaves keys with ⌘, Ctrl or Alt to the box", () => {
    expect(keyAction(press("ArrowDown", { metaKey: true }), initialAnswers(ONE), ONE)).toBeUndefined();
    expect(keyAction(press("1", { ctrlKey: true }), initialAnswers(ONE), ONE)).toBeUndefined();
    expect(keyAction(press("1", { altKey: true }), initialAnswers(ONE), ONE)).toBeUndefined();
  });

  it("changes question with ←/→ only when there are several", () => {
    expect(keyAction(press("ArrowLeft"), initialAnswers(ONE), ONE)).toBeUndefined();
    expect(keyAction(press("ArrowLeft"), initialAnswers(TWO), TWO)).toEqual({ tab: -1 });
    expect(keyAction(press("ArrowRight"), initialAnswers(TWO), TWO)).toEqual({ tab: 1 });
  });

  it("moves the highlight, ticks multi-select with space and picks by number", () => {
    const state = initialAnswers(TWO);
    expect(keyAction(press("ArrowUp"), state, TWO)).toEqual({ move: -1 });
    expect(keyAction(press("ArrowDown"), state, TWO)).toEqual({ move: 1 });
    expect(keyAction(press(" "), state, TWO)).toEqual({ tick: true });
    expect(keyAction(press(" "), { ...state, tab: 1 }, TWO)).toBeUndefined();
    expect(keyAction(press("2"), state, TWO)).toEqual({ pick: 1 });
    expect(keyAction(press("3"), state, TWO)).toBeUndefined();
    expect(keyAction(press("2", { shiftKey: true }), state, TWO)).toBeUndefined();
    expect(keyAction(press("a"), state, TWO)).toBeUndefined();
  });

  it("the Submit tab has no options to move through", () => {
    const state = { ...initialAnswers(TWO), tab: 2 };
    expect(keyAction(press("ArrowDown"), state, TWO)).toBeUndefined();
    expect(keyAction(press("ArrowLeft"), state, TWO)).toEqual({ tab: 1 });
  });
});
