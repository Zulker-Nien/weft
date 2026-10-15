import { describe, expect, it } from "vitest";
import type { Question } from "./types";
import {
  advance,
  buildReply,
  goTo,
  initialAnswers,
  isAnswered,
  isSubmitTab,
  moveCursor,
  notesOf,
  numberKey,
  pick,
  picksOf,
  previewHash,
  setCursor,
  setNotes,
  summary,
  tabCount,
} from "./question-answers";

// A question factory: by default one option, no multiSelect, no header, no preview.
const opt = (label: string, over: Partial<{ description: string; preview: string }> = {}) => ({
  label,
  description: undefined,
  preview: undefined,
  ...over,
});
const q = (
  question: string,
  options: { label: string; description?: string; preview?: string }[] = [{ label: "A" }],
  over: Partial<{ header: string; multiSelect: boolean }> = {},
): Question => ({
  question,
  options,
  header: undefined,
  multiSelect: undefined,
  ...over,
});

describe("initialAnswers", () => {
  it("builds an empty state with the same length as the questions", () => {
    const questions: Question[] = [q("Q1", [opt("A"), opt("B")]), q("Q2", [opt("C")])];
    expect(initialAnswers(questions)).toEqual({
      tab: 0,
      cursor: [0, 0],
      picked: [[], []],
      notes: ["", ""],
    });
  });

  it("builds an empty state for no questions", () => {
    expect(initialAnswers([])).toEqual({ tab: 0, cursor: [], picked: [], notes: [] });
  });
});

describe("tabCount", () => {
  it("is the question count, with a Submit tab only when there are several", () => {
    expect(tabCount([])).toBe(0);
    expect(tabCount([q("Q1")])).toBe(1);
    expect(tabCount([q("Q1"), q("Q2")])).toBe(3);
    expect(tabCount([q("Q1"), q("Q2"), q("Q3")])).toBe(4);
  });
});

describe("isSubmitTab", () => {
  it("is the Submit tab only with several questions, at index questions.length", () => {
    expect(isSubmitTab([q("Q1")], 0)).toBe(false);
    expect(isSubmitTab([q("Q1"), q("Q2")], 2)).toBe(true);
    expect(isSubmitTab([q("Q1"), q("Q2")], 0)).toBe(false);
    expect(isSubmitTab([q("Q1"), q("Q2")], 1)).toBe(false);
  });
});

describe("isAnswered", () => {
  it("is true when there is a pick", () => {
    const state = initialAnswers([q("Q1", [opt("A"), opt("B")])]);
    expect(isAnswered(pick(state, [q("Q1", [opt("A"), opt("B")])], 0), 0)).toBe(true);
  });

  it("is true when there is non-blank notes text", () => {
    expect(isAnswered({ ...initialAnswers([q("Q1")]), notes: ["  hi  "] }, 0)).toBe(true);
  });

  it("is false without a pick and with blank notes", () => {
    expect(isAnswered(initialAnswers([q("Q1", [opt("A")])]), 0)).toBe(false);
    expect(isAnswered({ ...initialAnswers([q("Q1")]), notes: ["   "] }, 0)).toBe(false);
  });
});

describe("picksOf / notesOf", () => {
  it("picksOf returns the picks for a question, or an empty array for an out-of-range index", () => {
    const state = initialAnswers([q("Q1", [opt("A"), opt("B")]), q("Q2")]);
    expect(picksOf(state, 0)).toEqual([]);
    expect(picksOf(state, 5)).toEqual([]);
  });

  it("notesOf returns the notes for a question, or an empty string for an out-of-range index", () => {
    const state = initialAnswers([q("Q1", [opt("A"), opt("B")]), q("Q2")]);
    expect(notesOf(state, 0)).toBe("");
    expect(notesOf(state, 5)).toBe("");
  });
});

describe("moveCursor", () => {
  it("moves the cursor by delta, wrapping around the option list", () => {
    const questions = [q("Q1", [opt("A"), opt("B"), opt("C")])];
    const start = initialAnswers(questions);
    expect(moveCursor(start, questions, 1)).toEqual({ ...start, cursor: [1] });
    expect(moveCursor({ ...start, cursor: [1] }, questions, 1)).toEqual({ ...start, cursor: [2] });
    expect(moveCursor({ ...start, cursor: [2] }, questions, 1)).toEqual({ ...start, cursor: [0] });
    expect(moveCursor(start, questions, -1)).toEqual({ ...start, cursor: [2] });
  });

  it("returns the same state when the shown question has no options", () => {
    const state = initialAnswers([q("Q1", [opt("A")]), q("Q2", [])]);
    expect(moveCursor({ ...state, tab: 1 }, [q("Q1", [opt("A")]), q("Q2", [])], 1)).toEqual({
      ...state,
      tab: 1,
    });
  });

  it("returns the same state when the shown tab is past the questions (no current question)", () => {
    const state = { ...initialAnswers([q("Q1", [opt("A")])]), tab: 5 };
    expect(moveCursor(state, [q("Q1", [opt("A")])], 1)).toBe(state);
  });

  it("uses 0 as the cursor when the shown tab has no entry in the cursor array", () => {
    const questions = [q("Q1", [opt("A"), opt("B")])];
    const state = { ...initialAnswers(questions), cursor: [] };
    expect(moveCursor(state, questions, 1)).toEqual({ ...state, cursor: [1] });
  });
});

describe("setCursor", () => {
  it("moves the cursor to the given option on the shown tab", () => {
    const start = initialAnswers([q("Q1", [opt("A"), opt("B")])]);
    expect(setCursor(start, 1)).toEqual({ ...start, cursor: [1] });
  });

  it("returns the same state when the cursor is already on that option", () => {
    const start = initialAnswers([q("Q1", [opt("A"), opt("B")])]);
    expect(setCursor(start, 0)).toBe(start);
  });
});

describe("pick", () => {
  it("replaces the pick on single-select", () => {
    const questions = [q("Q1", [opt("A"), opt("B"), opt("C")])];
    let state = initialAnswers(questions);
    state = pick(state, questions, 0);
    expect(state.picked).toEqual([["A"]]);
    state = pick(state, questions, 2);
    expect(state.picked).toEqual([["C"]]);
  });

  it("toggles the pick on multi-select", () => {
    const questions = [q("Q1", [opt("A"), opt("B")], { multiSelect: true })];
    let state = initialAnswers(questions);
    state = pick(state, questions, 0);
    expect(state.picked).toEqual([["A"]]);
    state = pick(state, questions, 1);
    expect(state.picked).toEqual([["A", "B"]]);
    state = pick(state, questions, 0);
    expect(state.picked).toEqual([["B"]]);
  });

  it("returns the same state for an out-of-range option", () => {
    const questions = [q("Q1", [opt("A")])];
    const start = initialAnswers(questions);
    expect(pick(start, questions, 5)).toBe(start);
  });
});

describe("setNotes", () => {
  it("writes the text into the shown tab", () => {
    const start = initialAnswers([q("Q1")]);
    expect(setNotes(start, "hi")).toEqual({ ...start, notes: ["hi"] });
  });

  it("returns the same state when the text is unchanged", () => {
    const start = { ...initialAnswers([q("Q1")]), notes: ["hi"] };
    expect(setNotes(start, "hi")).toBe(start);
  });

  it("returns the same state on the Submit tab (no notes slot)", () => {
    const state = { ...initialAnswers([q("Q1"), q("Q2")]), tab: 2 };
    expect(setNotes(state, "hi")).toBe(state);
  });
});

describe("goTo", () => {
  it("jumps to a tab, wrapping around the count", () => {
    const questions = [q("Q1"), q("Q2")];
    expect(goTo(initialAnswers(questions), questions, 1)).toEqual({ ...initialAnswers(questions), tab: 1 });
    expect(goTo(initialAnswers(questions), questions, 3)).toEqual({ ...initialAnswers(questions), tab: 0 });
    expect(goTo(initialAnswers(questions), questions, -1)).toEqual({ ...initialAnswers(questions), tab: 2 });
  });
});

describe("advance", () => {
  it("moves to the next unanswered question", () => {
    const questions = [q("Q1", [opt("A"), opt("B")]), q("Q2", [opt("C")])];
    let state = initialAnswers(questions);
    state = pick(state, questions, 0);
    expect(advance(state, questions)).toEqual({ ...state, tab: 1 });
  });

  it("moves to the Submit tab when every question is answered", () => {
    const questions = [q("Q1", [opt("A")]), q("Q2", [opt("C")])];
    let state = initialAnswers(questions);
    state = pick(state, questions, 0);
    state = { ...state, tab: 1 };
    state = pick(state, questions, 0);
    expect(advance(state, questions)).toEqual({ ...state, tab: 2 });
  });

  it("returns 'done' with one question when that question is answered", () => {
    const questions = [q("Q1", [opt("A"), opt("B")])];
    const state = pick(initialAnswers(questions), questions, 0);
    expect(advance(state, questions)).toBe("done");
  });
});

describe("buildReply", () => {
  it("sends the Submit tab's text as a note on all answers, with the first question, after its own note", () => {
    const questions = [q("Q1", [opt("A")]), q("Q2")];
    const state = { ...pick(initialAnswers(questions), questions, 0), notes: ["mine", "typed"] };
    expect(buildReply(state, questions, "  overall  ")).toEqual({
      answers: { Q1: "A", Q2: "typed" },
      annotations: { Q1: { notes: "mine; On all answers: overall" } },
    });
    const alone = { answers: { Q1: "A", Q2: "typed" }, annotations: { Q1: { notes: "On all answers: overall" } } };
    expect(buildReply({ ...state, notes: ["", "typed"] }, questions, "overall")).toEqual(alone);
    expect(buildReply(initialAnswers([]), [], "overall")).toEqual({ answers: {}, annotations: {} });
  });

  it("returns missing when a question is unanswered", () => {
    const questions = [q("Q1", [opt("A")]), q("Q2", [opt("B")])];
    const state = pick(initialAnswers(questions), questions, 0);
    expect(buildReply(state, questions)).toEqual({ missing: 1 });
  });

  it("joins a question's picks with commas, without notes or preview when none were set", () => {
    const questions = [q("Q1", [opt("A"), opt("B")], { multiSelect: true })];
    let state = initialAnswers(questions);
    state = pick(state, questions, 0);
    state = pick(state, questions, 1);
    expect(buildReply(state, questions)).toEqual({ answers: { Q1: "A, B" }, annotations: {} });
  });

  it("uses the composer's text as the answer when there are no picks", () => {
    const questions = [q("Q1", [opt("A")])];
    const state = { ...initialAnswers(questions), notes: ["  my own answer  "] };
    expect(buildReply(state, questions)).toEqual({ answers: { Q1: "my own answer" }, annotations: {} });
  });

  it("adds a notes annotation when the question has both a pick and notes text", () => {
    const questions = [q("Q1", [opt("A")])];
    let state = initialAnswers(questions);
    state = pick(state, questions, 0);
    state = setNotes(state, "because");
    expect(buildReply(state, questions)).toEqual({
      answers: { Q1: "A" },
      annotations: { Q1: { notes: "because" } },
    });
  });

  it("adds a preview annotation for each single pick with a preview, but not for multi-select picks or picks without one", () => {
    const questions = [
      q("Q1", [opt("A", { preview: "+A+" }), opt("B", { preview: "+B+" })]),
      q("Q2", [opt("C", { preview: "+C+" }), opt("D")]),
    ];
    let state = initialAnswers(questions);
    state = pick(state, questions, 0);
    state = { ...state, tab: 1 };
    state = pick(state, questions, 0);
    expect(buildReply(state, questions)).toEqual({
      answers: { Q1: "A", Q2: "C" },
      annotations: { Q1: { preview: "+A+" }, Q2: { preview: "+C+" } },
    });

    // Multi-select: no preview annotation even though every option had one.
    const multi = [q("Q", [opt("A", { preview: "+A+" }), opt("B", { preview: "+B+" })], { multiSelect: true })];
    let ms = initialAnswers(multi);
    ms = pick(ms, multi, 0);
    ms = pick(ms, multi, 1);
    expect(buildReply(ms, multi)).toEqual({ answers: { Q: "A, B" }, annotations: {} });

    // Single pick without a preview: no annotation either.
    const plain = [q("Q", [opt("A"), opt("B")])];
    let p = initialAnswers(plain);
    p = pick(p, plain, 0);
    expect(buildReply(p, plain)).toEqual({ answers: { Q: "A" }, annotations: {} });
  });
});

describe("numberKey", () => {
  it("returns the option index (1 -> 0) for 1..9 when in range", () => {
    expect(numberKey("1", 3)).toBe(0);
    expect(numberKey("3", 3)).toBe(2);
    expect(numberKey("9", 9)).toBe(8);
  });

  it("returns undefined for 0, multi-digit, or out-of-range", () => {
    expect(numberKey("0", 3)).toBeUndefined();
    expect(numberKey("a", 3)).toBeUndefined();
    expect(numberKey("12", 3)).toBeUndefined();
    expect(numberKey("4", 3)).toBeUndefined();
  });
});

describe("previewHash", () => {
  it("is '#<question>-<option>'", () => {
    expect(previewHash(0, 0)).toBe("#0-0");
    expect(previewHash(2, 5)).toBe("#2-5");
  });
});

describe("summary", () => {
  it("uses the header when present, the question otherwise, and the joined picks or notes as the answer", () => {
    const questions = [
      q("Q1", [opt("A"), opt("B")], { header: "Pick" }),
      q("Q2", [opt("C")]),
      q("Q3", [opt("D")]),
    ];
    let state = initialAnswers(questions);
    state = pick(state, questions, 0);
    state = { ...state, tab: 1 };
    state = setNotes(state, "  custom  ");
    state = { ...state, tab: 2 };
    state = pick(state, questions, 0);
    state = { ...state, tab: 2 };
    state = setNotes(state, "  note  ");
    expect(summary(state, questions)).toEqual([
      { label: "Pick", answer: "A", notes: "" },
      { label: "Q2", answer: "custom", notes: "" },
      { label: "Q3", answer: "D", notes: "note" },
    ]);
  });
});
