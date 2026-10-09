"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { folderName, formatCost, isLive, timeAgo } from "@/lib/format";
import type { Card } from "@/lib/types";
import Icon, { Spinner } from "./Icon";

export function BackendBadge({ backend }: { backend: Card["backend"] }) {
  return backend === "puku" ? (
    <span className="rounded px-1.5 py-px text-[11px] font-medium bg-puku-soft text-puku">puku</span>
  ) : (
    <span className="rounded px-1.5 py-px text-[11px] font-medium bg-claude-soft text-claude">claude</span>
  );
}

function StatusLine({ card }: { card: Card }) {
  if (card.error) {
    return (
      <div className="mt-2 flex items-start gap-1.5 text-danger">
        <Icon name="alert" size={12} className="mt-0.5" />
        <span className="line-clamp-2 font-mono text-[11.5px] leading-snug">{card.error}</span>
      </div>
    );
  }
  if (!card.lastLine) return null;
  const tone = {
    running: "text-accent",
    needs_you: "text-warn",
    review: "text-ok",
    backlog: "text-muted",
    done: "text-faint",
  }[card.column];
  return (
    <div className={`mt-2 flex items-start gap-1.5 ${tone}`}>
      {card.column === "running" && <span className="mt-0.5"><Spinner size={11} /></span>}
      {card.column === "needs_you" && <Icon name={card.pending ? "lock" : "alert"} size={12} className="mt-0.5" />}
      {card.column === "review" && <Icon name="check" size={12} className="mt-0.5" />}
      <span className="line-clamp-2 font-mono text-[11.5px] leading-snug">{card.lastLine}</span>
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
}: {
  card: Card;
  now: number;
  selected: boolean;
  // Moved here while you weren't looking; cleared when you open it.
  unseen?: boolean;
  onOpen: () => void;
  onAnswer: (allow: boolean) => void;
  onStop: () => void;
}) {
  // The request already answered here, so a second click can't answer it (or the next one) again.
  const [answeredId, setAnsweredId] = useState<string | null>(null);
  const live = isLive(card);
  const answered = answeredId !== null && answeredId === card.pending?.id;
  const needsLogin = card.column === "needs_you" && !card.pending && /^Log in to /.test(card.lastLine ?? "");
  const border = selected
    ? "border-accent ring-1 ring-accent"
    : unseen
      ? "border-accent/70 ring-1 ring-accent/40 card-unseen"
      : card.column === "needs_you"
      ? "border-warn/60"
      : "border-line hover:border-line-strong";
  const cost = formatCost(card.costUsd);

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
      className={`relative rounded-lg border bg-card px-3 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${border} ${live ? "" : "cursor-grab active:cursor-grabbing"}`}
    >
      {unseen && (
        <span title="New since you last looked" className="absolute right-1.5 top-1.5 size-2 animate-pulse rounded-full bg-accent" />
      )}
      <div className="line-clamp-2 text-[13px] font-medium leading-snug text-ink">{card.title}</div>
      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
        <BackendBadge backend={card.backend} />
        {card.source === "claude-code" && (
          <span className="shrink-0 whitespace-nowrap rounded bg-sunken px-1.5 py-px text-[11px] font-medium text-muted">Claude Code</span>
        )}
        <Icon name="folder" size={12} />
        <span className="truncate" title={card.cwd}>{folderName(card.cwd)}</span>
      </div>

      {(card.stage || card.remaining) && (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px]">
          {card.stage && <span className="shrink-0 rounded bg-sunken px-1.5 py-px text-muted">{card.stage}</span>}
          {card.remaining && <span className="truncate text-faint" title={card.remaining}>Left: {card.remaining}</span>}
        </div>
      )}

      <StatusLine card={card} />

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

      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-faint">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">
            {timeAgo(card.lastActivity ?? card.updatedAt, now)}
            {card.turns ? ` · ${card.turns} turn${card.turns === 1 ? "" : "s"}` : ""}
            {cost ? ` · ${cost}` : ""}
          </span>
          {card.openElsewhere && (
            <span
              className="flex shrink-0 items-center gap-1 text-muted"
              title="This thread is open in the Claude app or a terminal right now"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              open in Claude
            </span>
          )}
        </span>
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
