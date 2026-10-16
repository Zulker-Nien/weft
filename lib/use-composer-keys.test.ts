// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import type { SyntheticEvent } from "react";
import { describe, expect, it, vi } from "vitest";

const shortcuts = vi.hoisted(() => ({ currentBinding: vi.fn(() => ({ code: "Quote" })), matches: vi.fn(() => false) }));
vi.mock("@/lib/shortcuts", () => shortcuts);

import { useComposerKeys, type TypeaheadState } from "./use-composer-keys";
import type { SkillInfo } from "./types";

const skill = (name: string) => ({ name }) as SkillInfo;

function typeahead(over: Partial<TypeaheadState> = {}): TypeaheadState {
  return {
    query: { query: "d", from: 4, to: 6 },
    suggestions: [skill("a"), skill("b"), skill("c")],
    active: 0,
    setActive: vi.fn(),
    dismissedAt: null,
    setDismissedAt: vi.fn(),
    typeaheadOpen: true,
    ...over,
  };
}

function setup(t: TypeaheadState, state: "idle" | "recording" = "idle") {
  const dictation = { toggle: vi.fn(), cancel: vi.fn(), state } as never;
  const pickSkill = vi.fn();
  const { result } = renderHook(() => useComposerKeys({ typeahead: t, dictation, pickSkill }));
  return { ...result.current, dictation: dictation as { toggle: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }, pickSkill };
}

function press(init: KeyboardEventInit & { key: string }) {
  const ne = new KeyboardEvent("keydown", { cancelable: true, bubbles: true, ...init });
  const prevent = vi.spyOn(ne, "preventDefault");
  const stop = vi.spyOn(ne, "stopPropagation");
  return { ne, prevent, stop, e: { nativeEvent: ne } as unknown as SyntheticEvent };
}

describe("typeahead keys", () => {
  it("ArrowDown and ArrowUp wrap around the suggestions", () => {
    const t = typeahead();
    const { onKeyDownCapture } = setup(t);
    const down = press({ key: "ArrowDown" });
    onKeyDownCapture(down.e);
    const next = vi.mocked(t.setActive).mock.calls[0]?.[0] as (i: number) => number;
    expect([next(0), next(2)]).toEqual([1, 0]);
    expect(down.prevent).toHaveBeenCalled();
    expect(down.stop).toHaveBeenCalled();

    onKeyDownCapture(press({ key: "ArrowUp" }).e);
    const prev = vi.mocked(t.setActive).mock.calls[1]?.[0] as (i: number) => number;
    expect([prev(2), prev(0)]).toEqual([1, 2]);
  });

  it("Escape dismisses the query where it starts", () => {
    const t = typeahead();
    setup(t).onKeyDownCapture(press({ key: "Escape" }).e);
    expect(t.setDismissedAt).toHaveBeenCalledWith(4);
  });

  it("Enter and Tab pick the active suggestion, clamped to the list", () => {
    const t = typeahead({ active: 9 });
    const { onKeyDownCapture, pickSkill } = setup(t);
    onKeyDownCapture(press({ key: "Enter" }).e);
    onKeyDownCapture(press({ key: "Tab" }).e);
    expect(pickSkill).toHaveBeenNthCalledWith(1, skill("c"));
    expect(pickSkill).toHaveBeenCalledTimes(2);
  });

  it("takes the key but picks nothing when the list is empty", () => {
    const t = typeahead({ suggestions: [] });
    const { onKeyDownCapture, pickSkill } = setup(t);
    const k = press({ key: "Enter" });
    onKeyDownCapture(k.e);
    expect(k.prevent).toHaveBeenCalled();
    expect(pickSkill).not.toHaveBeenCalled();
  });

  it("leaves keys alone when closed, with no query, mid-composition, or for other keys", () => {
    for (const [t, init] of [
      [typeahead({ typeaheadOpen: false }), { key: "Enter" }],
      [typeahead({ query: null }), { key: "Enter" }],
      [typeahead(), { key: "Enter", isComposing: true }],
      [typeahead(), { key: "a" }],
    ] as const) {
      const { onKeyDownCapture, pickSkill } = setup(t);
      const k = press(init);
      onKeyDownCapture(k.e);
      expect(k.prevent).not.toHaveBeenCalled();
      expect(pickSkill).not.toHaveBeenCalled();
    }
  });
});

describe("dictation binding", () => {
  it("toggles the mic and claims the key", () => {
    shortcuts.matches.mockReturnValueOnce(true);
    const { onKeyDownCapture, dictation } = setup(typeahead({ typeaheadOpen: false }));
    const k = press({ key: "æ" });
    onKeyDownCapture(k.e);
    expect(dictation.toggle).toHaveBeenCalled();
    expect(k.prevent).toHaveBeenCalled();
  });

  it("claims a held-down repeat without toggling again", () => {
    shortcuts.matches.mockReturnValueOnce(true);
    const { onKeyDownCapture, dictation } = setup(typeahead({ typeaheadOpen: false }));
    const k = press({ key: "æ", repeat: true });
    onKeyDownCapture(k.e);
    expect(dictation.toggle).not.toHaveBeenCalled();
    expect(k.prevent).toHaveBeenCalled();
  });

  it("ignores other keys and composition", () => {
    const { onKeyDownCapture, dictation } = setup(typeahead({ typeaheadOpen: false }));
    onKeyDownCapture(press({ key: "x" }).e);
    shortcuts.matches.mockReturnValueOnce(true);
    onKeyDownCapture(press({ key: "x", isComposing: true }).e);
    expect(dictation.toggle).not.toHaveBeenCalled();
  });

  it("ignores events that aren't keyboard events", () => {
    const { onKeyDownCapture, onKeyDown, dictation } = setup(typeahead());
    onKeyDownCapture({ nativeEvent: new Event("keydown") } as unknown as SyntheticEvent);
    onKeyDown({ nativeEvent: new Event("keydown") } as unknown as SyntheticEvent);
    expect(dictation.toggle).not.toHaveBeenCalled();
    expect(dictation.cancel).not.toHaveBeenCalled();
  });
});

describe("Escape while recording", () => {
  it("cancels the recording", () => {
    const { onKeyDown, dictation } = setup(typeahead(), "recording");
    const k = press({ key: "Escape" });
    onKeyDown(k.e);
    expect(dictation.cancel).toHaveBeenCalled();
    expect(k.stop).toHaveBeenCalled();
  });

  it("does nothing when idle or for another key", () => {
    const idle = setup(typeahead());
    idle.onKeyDown(press({ key: "Escape" }).e);
    const rec = setup(typeahead(), "recording");
    rec.onKeyDown(press({ key: "a" }).e);
    expect(idle.dictation.cancel).not.toHaveBeenCalled();
    expect(rec.dictation.cancel).not.toHaveBeenCalled();
  });
});
