"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { folderName, isLive, STAGES, stageStep, timeAgo } from "@/lib/format";
import { isBusy } from "@/lib/overlap";
import { formatAt } from "@/lib/schedule";
import type { Card } from "@/lib/types";
import { ContinueButton, RestartButton, type ResumeHow } from "./CardResume";
import CardPicture from "./CardPicture";
import Icon, { Spinner } from "./Icon";
import StarButton from "./StarButton";

export function BackendBadge({ backend }: { backend: Card["backend"] }) {
  return backend === "puku" ? (
    <span className="rounded px-1.5 py-px text-[11px] font-medium bg-puku-soft text-puku">puku</span>
  ) : (
    <span className="rounded px-1.5 py-px text-[11px] font-medium bg-claude-soft text-claude">claude</span>
  );
}

// The card's column colour, shared by the summary icon and the stage bar.
const TONE: Record<Card["column"], { text: string; bar: string }> = {
  running: { text: "text-accent", bar: "bg-accent" },
  needs_you: { text: "text-warn", bar: "bg-warn" },
  review: { text: "text-ok", bar: "bg-ok" },
  backlog: { text: "text-muted", bar: "bg-muted" },
  done: { text: "text-faint", bar: "bg-faint" },
};

// What the thread last said: the line you read to decide whether to open it.
function Summary({ card }: { card: Card }) {
  if (card.error) {
    return (
      <div className="mt-1 flex items-start gap-1.5 text-danger">
        <Icon name="alert" size={12} className="mt-[3px] shrink-0" />
        <span className="line-clamp-2 text-[12px] leading-snug">{card.error}</span>
      </div>
    );
  }
  if (!card.lastLine) return null;
  const icon =
    card.column === "running" ? (
      <span className="mt-[3px] shrink-0 text-accent"><Spinner size={11} /></span>
    ) : card.column === "needs_you" ? (
      <Icon name={card.pending ? "lock" : "alert"} size={12} className="mt-[3px] shrink-0 text-warn" />
    ) : null;
  return (
    <div className="mt-1 flex items-start gap-1.5">
      {icon}
      <span className={`line-clamp-2 text-[12px] leading-snug ${card.column === "done" ? "text-faint" : "text-muted"}`}>
        {card.lastLine}
      </span>
    </div>
  );
}

// How far along the card is (the BOARD STATUS stage) and what's left, on one line.
function Progress({ card }: { card: Card }) {
  const step = stageStep(card.stage);
  // In Done, "Done" says nothing the column doesn't.
  if (card.column === "done" && (step === STAGES.length || !card.remaining)) return null;
  if (!card.stage && !card.remaining) return null;
  const tone = TONE[card.column];
  return (
    <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px]">
      {step > 0 && (
        <span className="flex shrink-0 gap-[2px]" title={`${card.stage}: step ${step} of ${STAGES.length}`} aria-hidden>
          {STAGES.map((s, i) => (
            <span key={s} className={`h-[5px] w-[5px] rounded-full ${i < step ? tone.bar : "bg-line-strong"}`} />
          ))}
        </span>
      )}
      {card.stage && <span className={`shrink-0 font-medium ${tone.text}`}>{card.stage}</span>}
      {card.remaining && card.remaining !== "none" && (
        <span className="truncate text-faint" title={`Left: ${card.remaining}`}>· {card.remaining}</span>
      )}
    </div>
  );
}

export default function CardView({
  card,
  now,
  selected,
  unseen = false,
  onOpen,
  onAnswer,
  onStop,
  onResume,
  onContextMenu,
  onStarMenu,
  alsoHere = [],
}: {
  card: Card;
  now: number;
  selected: boolean;
  // Moved here while you weren't looking; cleared when you open it.
  unseen?: boolean;
  onOpen: () => void;
  onAnswer: (allow: boolean) => void;
  onStop: () => void;
  // ▶ sends "continue" into the card's session; Restart (on a stopped or failed card) runs its last message again.
  onResume?: (how: ResumeHow) => void;
  // Right-click: the card's menu (lib/card-menu.ts).
  onContextMenu?: (e: React.MouseEvent) => void;
  // The ☆: file the card in the library (lib/card-menu.ts starMenu).
  onStarMenu?: (e: React.MouseEvent) => void;
  // Other busy cards in this folder (lib/overlap.ts busyHere); flagged only while this one is busy too.
  alsoHere?: Card[];
}) {
  // The request already answered here, so a second click can't answer it (or the next one) again.
  const [answeredId, setAnsweredId] = useState<string | null>(null);
  const live = isLive(card);
  const scheduled = card.scheduled ?? [];
  const nextSend = scheduled[0];
  const answered = answeredId !== null && answeredId === card.pending?.id;
  const needsLogin = card.column === "needs_you" && !card.pending && /^Log in to /.test(card.lastLine ?? "");
  const border = selected
    ? "border-accent ring-1 ring-accent"
    : unseen
      ? "border-accent/70 ring-1 ring-accent/40 card-unseen"
      : card.column === "needs_you"
      ? "border-warn/60"
      : "border-line hover:border-line-strong";

  function answer(allow: boolean) {
    if (!card.pending || answered) return;
    setAnsweredId(card.pending.id);
    onAnswer(allow);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={!live}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", card.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      data-card-id={card.id}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      className={`group relative rounded-lg border bg-card px-3 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${border} ${live ? "" : "cursor-grab active:cursor-grabbing"}`}
    >
      {unseen && (
        <span title="New since you last looked" className="absolute right-1 top-1 z-10 size-2.5 animate-pulse rounded-full border-2 border-card bg-accent" />
      )}
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className={`line-clamp-2 text-[13px] font-medium leading-snug ${card.column === "done" ? "text-muted" : "text-ink"}`}>
            {card.title}
          </div>
          <Summary card={card} />
        </div>
        <CardPicture card={card} />
      </div>
      <Progress card={card} />
      <RestartButton card={card} onResume={onResume} />

      {needsLogin && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            void api.login(card.backend, "start").catch(() => {});
          }}
          className="mt-2 rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-on-accent hover:opacity-90"
        >
          Log in
        </button>
      )}

      {card.pending?.questions && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="mt-2 rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-on-accent hover:opacity-90"
        >
          Answer
        </button>
      )}

      {card.column === "needs_you" && card.pending && !card.pending.questions && (
        <div className="mt-2 flex gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              answer(true);
            }}
            disabled={answered}
            className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            Allow
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              answer(false);
            }}
            disabled={answered}
            className="rounded-md border border-line-strong px-2.5 py-1 text-[12px] text-ink hover:bg-sunken disabled:opacity-50"
          >
            Deny
          </button>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-1.5 text-[11px] text-faint">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={`size-1.5 shrink-0 rounded-full ${card.backend === "puku" ? "bg-puku" : "bg-claude"}`}
            title={`${card.backend === "puku" ? "puku" : "claude"}${card.source === "claude-code" ? " · picked up from Claude Code" : ""}`}
          />
          <span className="truncate font-medium text-muted" title={card.cwd}>{folderName(card.cwd)}</span>
          {isBusy(card) && alsoHere.length > 0 && (
            <span
              className="shrink-0 font-medium text-warn"
              title={`Also running in this folder (shared working tree):\n${alsoHere.map((c) => c.title).join("\n")}`}
            >
              +{alsoHere.length} here
            </span>
          )}
          <span className="shrink-0 whitespace-nowrap">
            {timeAgo(card.lastActivity ?? card.updatedAt, now).replace(" ago", "")}
            {card.turns ? ` · ${card.turns}t` : ""}
          </span>
          {nextSend ? (
            <span
              className="flex shrink-0 items-center gap-0.5 text-accent"
              title={`${scheduled.length} message${scheduled.length > 1 ? "s" : ""} scheduled; the next sends ${formatAt(nextSend.at, now)}`}
            >
              <Icon name="clock" size={10} />
              {formatAt(nextSend.at, now)}
            </span>
          ) : null}
          {card.openElsewhere && (
            <span
              className="flex shrink-0 items-center gap-1 text-muted"
              title="This thread is open in the Claude app or a terminal right now"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              open
            </span>
          )}
        </span>
        <ContinueButton card={card} onResume={onResume} />
        <StarButton variant="card" starred={Boolean(card.libraryId)} onClick={onStarMenu} />
        {live && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStop();
            }}
            title="Stop this thread"
            aria-label="Stop this thread"
            className="rounded p-1 text-muted hover:bg-sunken hover:text-danger"
          >
            <Icon name="stop" size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
