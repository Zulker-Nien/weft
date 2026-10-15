import type { Question, QuestionReply } from "./types";

// Answering an agent's AskUserQuestion the Claude Code way: one question at a time (tabs when it asked
// several, then a Submit tab), a highlighted option you move with ↑/↓ or pick by number, checkboxes for
// multi-select, and one text box, the reply composer, whose text is your own answer when nothing is picked
// and a note on your pick when something is. Pure, so components/QuestionForm.tsx only draws it.

export interface AnswerState {
  tab: number; // the question shown; questions.length is the Submit tab
  cursor: number[]; // the highlighted option per question
  picked: string[][]; // the picked option labels per question
  notes: string[]; // the composer's text per question, kept while another tab is shown
}

// One question's picks and box text.
export const picksOf = (state: AnswerState, i: number) => state.picked[i] ?? [];
export const notesOf = (state: AnswerState, i: number) => state.notes[i] ?? "";

export function initialAnswers(questions: Question[]): AnswerState {
  return { tab: 0, cursor: questions.map(() => 0), picked: questions.map(() => []), notes: questions.map(() => "") };
}

// The Submit tab exists only when there are several questions; one question sends straight away.
export const tabCount = (questions: Question[]) => questions.length + (questions.length > 1 ? 1 : 0);

export const isSubmitTab = (questions: Question[], tab: number) => questions.length > 1 && tab === questions.length;

export const isAnswered = (state: AnswerState, i: number) => picksOf(state, i).length > 0 || notesOf(state, i).trim() !== "";

// Highlights the next or previous option, wrapping around.
export function moveCursor(state: AnswerState, questions: Question[], delta: number): AnswerState {
  const count = questions[state.tab]?.options.length ?? 0;
  if (!count) return state;
  const cursor = [...state.cursor];
  cursor[state.tab] = ((cursor[state.tab] ?? 0) + delta + count) % count;
  return { ...state, cursor };
}

export function setCursor(state: AnswerState, option: number): AnswerState {
  if (state.cursor[state.tab] === option) return state;
  const cursor = [...state.cursor];
  cursor[state.tab] = option;
  return { ...state, cursor };
}

// Picks an option on the shown question: single-select replaces the pick, multi-select toggles it.
export function pick(state: AnswerState, questions: Question[], option: number): AnswerState {
  const q = questions[state.tab];
  const label = q?.options[option]?.label;
  if (!q || label === undefined) return state;
  const current = picksOf(state, state.tab);
  const next = q.multiSelect ? (current.includes(label) ? current.filter((l) => l !== label) : [...current, label]) : [label];
  const picked = [...state.picked];
  picked[state.tab] = next;
  return setCursor({ ...state, picked }, option);
}

export function setNotes(state: AnswerState, text: string): AnswerState {
  if (state.tab >= state.notes.length || state.notes[state.tab] === text) return state;
  const notes = [...state.notes];
  notes[state.tab] = text;
  return { ...state, notes };
}

export function goTo(state: AnswerState, questions: Question[], tab: number): AnswerState {
  const count = tabCount(questions);
  return { ...state, tab: ((tab % count) + count) % count };
}

// After a question is answered: the next unanswered one, else the Submit tab (or "done" with one question).
export function advance(state: AnswerState, questions: Question[]): AnswerState | "done" {
  for (let step = 1; step <= questions.length; step++) {
    const i = (state.tab + step) % questions.length;
    if (!isAnswered(state, i)) return { ...state, tab: i };
  }
  return questions.length > 1 ? { ...state, tab: questions.length } : "done";
}

// The answer for each question, plus notes where text sits beside a pick, or the first question left unanswered.
// general: what was typed in the box on the Submit tab, a note on all the answers, sent with the first question.
export function buildReply(
  state: AnswerState,
  questions: Question[],
  general = "",
): { answers: Record<string, string>; annotations: NonNullable<QuestionReply["annotations"]> } | { missing: number } {
  const answers: Record<string, string> = {};
  const annotations: NonNullable<QuestionReply["annotations"]> = {};
  for (const [i, q] of questions.entries()) {
    const labels = picksOf(state, i);
    const text = notesOf(state, i).trim();
    if (!labels.length && !text) return { missing: i };
    if (!labels.length) {
      answers[q.question] = text;
      continue;
    }
    answers[q.question] = labels.join(", ");
    // The preview you were looking at when you picked, as Claude Code sends it.
    const preview = labels.length === 1 ? q.options.find((o) => o.label === labels[0])?.preview : undefined;
    if (text || preview) annotations[q.question] = { ...(text ? { notes: text } : {}), ...(preview ? { preview } : {}) };
  }
  addGeneralNote(annotations, questions[0]?.question, general.trim());
  return { answers, annotations };
}

// The Submit tab's note goes on the first question, after any note of its own.
function addGeneralNote(annotations: NonNullable<QuestionReply["annotations"]>, first: string | undefined, note: string) {
  if (!note || first === undefined) return;
  const notes = [annotations[first]?.notes, `On all answers: ${note}`].filter(Boolean).join("; ");
  annotations[first] = { ...annotations[first], notes };
}

// A number key's option (1 to 9), or undefined.
export function numberKey(key: string, count: number) {
  if (!/^[1-9]$/.test(key)) return undefined;
  const option = Number(key) - 1;
  return option < count ? option : undefined;
}

// Where the preview page (lib/question-preview.ts) shows one option.
export const previewHash = (question: number, option: number) => `#${question}-${option}`;

// One line per question for the Submit tab: what will be sent.
export function summary(state: AnswerState, questions: Question[]) {
  return questions.map((q, i) => ({
    label: q.header || q.question,
    answer: picksOf(state, i).join(", ") || notesOf(state, i).trim(),
    notes: picksOf(state, i).length ? notesOf(state, i).trim() : "",
  }));
}
