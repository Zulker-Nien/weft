"use client";

import { useEffect, useImperativeHandle, useState, type KeyboardEvent, type Ref, type RefObject } from "react";
import {
  advance,
  buildReply,
  goTo,
  initialAnswers,
  isAnswered,
  isSubmitTab,
  moveCursor,
  notesOf,
  pick,
  picksOf,
  previewHash,
  setCursor,
  setNotes,
  type AnswerState,
} from "@/lib/question-answers";
import { keyAction, type KeyAction } from "@/lib/question-keys";
import type { PendingPermission, Question, QuestionReply } from "@/lib/types";
import type { ComposerHandle } from "./Composer";
import { Options, QuestionTabs, Review } from "./QuestionParts";

export interface QuestionFormHandle {
  // A key pressed in the reply box; true when the form used it (only with an empty box and no modifiers).
  key(e: KeyboardEvent, boxEmpty: boolean): boolean;
  // Enter in the reply box: answers the shown question with the box's text, then moves on or sends.
  enter(): void;
}

export interface QuestionProps {
  questions: Question[];
  // A folder outside the project that a question names (lib/runner-ask.ts): "Read from <path>" grants it.
  readScope?: PendingPermission["readScope"];
  // The options' preview page (lib/question-preview.ts), shown in the card's browser pane.
  previewUrl?: string;
  onAnswer: (answers: Record<string, string>, annotations: NonNullable<QuestionReply["annotations"]>) => void;
  // The parent persists the read scope and queues /add-dir for the live session (lib/read-scope.ts).
  onReadScope?: (path: string) => void;
}

// An agent's AskUserQuestion, the way Claude Code asks it: a tab per question (and a Submit tab when
// there are several), numbered options moved with ↑/↓ or picked by number, checkboxes for multi-select,
// and the reply box under it as the one place to type: your own answer, or a note on your pick.
// The logic is lib/question-answers.ts; the reply box (components/ReplyBox.tsx) routes its keys here.
export default function QuestionForm({
  ref,
  cardId,
  composer,
  questions,
  readScope,
  previewUrl,
  onAnswer,
  onReadScope,
}: QuestionProps & {
  ref?: Ref<QuestionFormHandle>;
  cardId: string;
  composer: RefObject<ComposerHandle | null>;
}) {
  const [state, setState] = useState(() => initialAnswers(questions));
  const [error, setError] = useState<string | null>(null);
  // Set once an answer is sent; the form is keyed by the request, so the next one starts fresh.
  const [sent, setSent] = useState(false);
  const submitTab = isSubmitTab(questions, state.tab);
  const q = submitTab ? undefined : questions[state.tab];
  const cursor = state.cursor[state.tab] ?? 0;
  const shown = q?.options[cursor];

  // The highlighted option's preview, in the card's browser pane.
  const bridge = typeof window !== "undefined" ? window.threadboard : undefined;
  const previewing = q?.options.some((o) => o.preview) ? `${previewUrl ?? ""}${previewHash(state.tab, cursor)}` : null;
  useEffect(() => {
    if (previewing && previewUrl && bridge) void bridge.browser.open(previewing, cardId).catch(() => {});
  }, [previewing, previewUrl, bridge, cardId]);

  // The box's text, as Markdown when it reads (an upload may still be running), else as typed.
  function boxText() {
    try {
      return composer.current?.read() ?? "";
    } catch {
      return composer.current?.readText() ?? "";
    }
  }

  // Moves to another tab: the box's text stays with the question it was written for.
  function show(next: AnswerState, from: AnswerState) {
    setError(null);
    setState(next);
    if (next.tab === from.tab) return;
    const text = notesOf(next, next.tab);
    if (text) composer.current?.write(text);
    else composer.current?.clear();
  }

  function withBox(s: AnswerState) {
    return isSubmitTab(questions, s.tab) ? s : setNotes(s, boxText());
  }

  // Text typed on the Submit tab is a note on all the answers, so nothing written in the box is lost.
  function send(s: AnswerState) {
    if (sent) return;
    const reply = buildReply(s, questions, isSubmitTab(questions, s.tab) ? boxText() : "");
    if ("missing" in reply) {
      const missing = questions[reply.missing];
      show(goTo(s, questions, reply.missing), s);
      setError(`Answer “${missing?.header || missing?.question}” first: pick an option or type your own.`);
      return;
    }
    setSent(true);
    composer.current?.clear();
    onAnswer(reply.answers, reply.annotations);
  }

  // The shown question is answered: on to the next unanswered one, or send.
  function next(s: AnswerState) {
    const after = advance(s, questions);
    if (after === "done") send(s);
    else show(after, s);
  }

  function choose(option: number) {
    if (sent || !q) return;
    const s = pick(withBox(state), questions, option);
    if (q.multiSelect) show(s, state);
    else next(s);
  }

  function enter() {
    if (sent) return;
    if (!q) {
      send(state);
      return;
    }
    const s = withBox(state);
    if (isAnswered(s, s.tab)) next(s);
    // An empty box answers with the highlighted option (multi-select ticks it first).
    else if (q.multiSelect) show(pick(s, questions, cursor), state);
    else next(pick(s, questions, cursor));
  }

  function act(action: KeyAction) {
    if ("tab" in action) show(goTo(withBox(state), questions, action.tab), state);
    else if ("move" in action) setState(moveCursor(state, questions, action.move));
    else if ("tick" in action) show(pick(state, questions, cursor), state);
    else choose(action.pick);
  }

  function readFrom() {
    if (sent || !readScope || !onReadScope) return;
    setSent(true);
    onReadScope(readScope.directory);
    const s = withBox(state);
    // The grant is the answer: it goes with whatever else was picked or typed, and the agent retries the read.
    const answers: Record<string, string> = {};
    for (const [i, question] of questions.entries()) {
      const typed = picksOf(s, i).length ? [] : [notesOf(s, i).trim()].filter(Boolean);
      answers[question.question] = [...picksOf(s, i), ...typed, `You can read from ${readScope.directory} — try again`].join(", ");
    }
    composer.current?.clear();
    onAnswer(answers, {});
  }

  useImperativeHandle(ref, () => ({
    key(e, boxEmpty) {
      const action = !sent && boxEmpty ? keyAction(e, state, questions) : undefined;
      if (action) act(action);
      return Boolean(action);
    },
    enter,
  }));

  const toTab = (tab: number) => show(goTo(withBox(state), questions, tab), state);
  return (
    <div className="mb-2 flex max-h-[50vh] min-h-0 flex-col rounded-md border border-warn/40 bg-warn-soft px-3 py-2.5">
      <QuestionTabs questions={questions} state={state} onTab={toTab} />
      <div className="-mr-2 mt-2 min-h-0 overflow-y-auto pr-2">
        {q ? (
          <Options
            q={q}
            picked={picksOf(state, state.tab)}
            cursor={cursor}
            sent={sent}
            // No browser pane (a plain browser tab): the preview sits under the options instead.
            inlinePreview={bridge ? undefined : shown?.preview}
            onHover={(i) => setState((s) => setCursor(s, i))}
            onChoose={choose}
            onType={() => composer.current?.focus()}
          />
        ) : (
          <Review questions={questions} state={state} onTab={toTab} />
        )}
      </div>
      {error && <p className="mt-1.5 shrink-0 text-[12px] text-danger">{error}</p>}
      {readScope && onReadScope && !sent && (
        <button
          onClick={readFrom}
          className="mt-2 shrink-0 rounded-md border border-accent bg-accent-soft px-3 py-1.5 text-left text-[12.5px] text-ink hover:bg-accent/30"
        >
          <span className="font-medium">Read from {readScope.token}</span>
          <span className="block text-[11.5px] text-muted">Grant this thread read access — no need to paste the file.</span>
        </button>
      )}
      <p className="mt-2 shrink-0 truncate text-[11px] text-faint">{keyHint(questions, q)}</p>
    </div>
  );
}

// The keys the box takes for the shown question.
function keyHint(questions: Question[], q: Question | undefined) {
  if (!q) return "⏎ send answers · text in the box goes with them as a note";
  const multi = questions.length > 1;
  const parts = [
    "↑↓ choose",
    `1–${Math.min(q.options.length, 9)} pick`,
    q.multiSelect ? "space tick" : "",
    multi ? "⏎ next" : "⏎ send",
    multi ? "←→ questions" : "",
  ];
  return parts.filter(Boolean).join(" · ");
}
