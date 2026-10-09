"use client";

import { useState } from "react";
import type { Question } from "@/lib/types";

// Answers an agent's AskUserQuestion: pick an option (or several), or type your own.
export default function QuestionForm({
  questions,
  onAnswer,
  onSkip,
}: {
  questions: Question[];
  onAnswer: (answers: Record<string, string>) => void;
  onSkip: () => void;
}) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  // Set once an answer or skip is sent; the form is keyed by the request, so the next one starts fresh.
  const [submitting, setSubmitting] = useState(false);

  function toggle(q: Question, label: string) {
    setError(null);
    setPicked((prev) => {
      const current = prev[q.question] ?? [];
      const next = q.multiSelect
        ? current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label]
        : [label];
      return { ...prev, [q.question]: next };
    });
    if (!q.multiSelect) setOther((prev) => ({ ...prev, [q.question]: "" }));
  }

  function submit() {
    if (submitting) return;
    const answers: Record<string, string> = {};
    for (const q of questions) {
      const typed = other[q.question]?.trim();
      const chosen = [...(picked[q.question] ?? []), ...(typed ? [typed] : [])];
      if (!chosen.length) {
        setError(`Answer “${q.header || q.question}” first.`);
        return;
      }
      answers[q.question] = chosen.join(", ");
    }
    setSubmitting(true);
    onAnswer(answers);
  }

  function skip() {
    if (submitting) return;
    setSubmitting(true);
    onSkip();
  }

  return (
    <div className="flex flex-col gap-3">
      {questions.map((q) => (
        <div key={q.question} className="flex flex-col gap-1.5">
          <div className="text-[13px] font-medium leading-snug text-ink">
            {q.header && <span className="mr-1.5 rounded bg-panel px-1.5 py-px text-[11px] font-normal text-muted">{q.header}</span>}
            {q.question}
          </div>
          <div className="flex flex-col gap-1">
            {q.options.map((option) => {
              const on = picked[q.question]?.includes(option.label);
              return (
                <button
                  key={option.label}
                  onClick={() => toggle(q, option.label)}
                  className={`rounded-md border px-2.5 py-1.5 text-left text-[12.5px] ${on ? "border-accent bg-accent-soft text-ink" : "border-line-strong bg-panel text-ink hover:bg-sunken"}`}
                >
                  <span className="font-medium">{option.label}</span>
                  {option.description && <span className="block text-[11.5px] text-muted">{option.description}</span>}
                </button>
              );
            })}
            <input
              value={other[q.question] ?? ""}
              onChange={(e) => {
                setError(null);
                setOther((prev) => ({ ...prev, [q.question]: e.target.value }));
                if (!q.multiSelect && e.target.value) setPicked((prev) => ({ ...prev, [q.question]: [] }));
              }}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Something else"
              className="rounded-md border border-line-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-accent"
            />
          </div>
        </div>
      ))}
      {error && <p className="text-[12px] text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={submitting}
          className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          Send answer
        </button>
        <button
          onClick={skip}
          disabled={submitting}
          className="rounded-md border border-line-strong bg-panel px-3 py-1.5 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
