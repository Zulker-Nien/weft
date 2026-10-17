"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { chipsFor, STARTERS } from "@/lib/copilot-starters";
import { readViewPrefs } from "@/lib/view-prefs";

type Chips = { chips: { text: string; project?: string; covers?: string[] }[]; covers: string[] };

const CHIP =
  "max-w-full rounded-2xl border px-3 py-1 text-left text-[12.5px] leading-snug text-ink hover:bg-sunken";

// What a new copilot chat shows: what it can do, a few suggestions Haiku made from your board (lib/copilot-suggest.ts,
// usually ready from the background refresh, else ~15s), and the fixed starters, minus any a board chip already covers.
// The chips wrap side by side so they fit a narrow lane, and a long one breaks onto a second line. Only the selected
// project's chips show (project: the board's pick, else the saved one; null is All); each chip names its project, so a
// switch just filters the one reply.
export default function CopilotEmpty({ onAsk, project }: { onAsk: (text: string) => void; project?: string | null }) {
  const scope = project !== undefined ? project : typeof document === "undefined" ? null : (readViewPrefs().project ?? null);
  const [fromBoard, setFromBoard] = useState<Chips | null>(null);
  useEffect(() => {
    let live = true;
    api
      .copilotSuggestions()
      .then((r) => live && setFromBoard(r))
      .catch(() => live && setFromBoard({ chips: [], covers: [] }));
    return () => void (live = false);
  }, []);

  const ask = (text: string) => {
    void api.copilotChipClicked(text).catch(() => {});
    onAsk(text);
  };
  const chip = (text: string, accent = false) => (
    <button
      key={text}
      onClick={() => ask(text)}
      className={`${CHIP} ${accent ? "border-accent/50 bg-accent/10" : "border-line-strong bg-canvas/70"}`}
    >
      {text}
    </button>
  );
  const shown = fromBoard ? chipsFor(fromBoard, scope) : null;
  const covered = shown?.covers ?? new Set<string>();

  return (
    <div className="flex flex-col gap-3 pt-6">
      <p className="text-[13px] leading-relaxed text-muted">
        I can check on your threads, start new ones, and reply to them for you.
      </p>
      {fromBoard === null ? (
        <p className="text-[11.5px] text-faint">Reading your board…</p>
      ) : (
        shown && shown.chips.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[11.5px] text-faint">From your board</p>
            <div className="flex flex-wrap items-start gap-1.5">{shown.chips.map((c) => chip(c.text, true))}</div>
          </div>
        )
      )}
      <div className="flex flex-wrap items-start gap-1.5">
        {STARTERS.filter((s) => !covered.has(s)).map((text) => chip(text))}
      </div>
    </div>
  );
}
