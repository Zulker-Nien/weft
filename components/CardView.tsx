"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { folderName, isLive, STAGES, stageStep, timeAgo } from "@/lib/format";
import { modelLabel, runningOn } from "@/lib/new-thread";
import { isBusy } from "@/lib/overlap";
import { formatAt } from "@/lib/schedule";
import { type Card } from "@/lib/types";
import { ContinueButton, RestartButton, type ResumeHow } from "./CardResume";
import CardPicture from "./CardPicture";
import Icon, { Spinner } from "./Icon";
import StarButton from "./StarButton";
import Tip from "./Tip";
import CardMarks from "./CardMarks";

// The footer's left side: CLI dot, folder (or "whole board" for the copilot), overlap, age, turns, scheduled
// sends, open elsewhere, and the card's issue and tags when it has no progress line.
function FooterMeta({ card, now, alsoHere, marks }: { card: Card; now: number; alsoHere: Card[]; marks: React.ReactNode }) {
  const copilot = card.role === "copilot";
  const scheduled = card.scheduled ?? [];
  const nextSend = scheduled[0];
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        className={`size-1.5 shrink-0 rounded-full ${card.backend === "puku" ? "bg-puku" : "bg-claude"}`}
        title={`${card.backend === "puku" ? "puku" : "claude"}${card.source === "claude-code" ? " · picked up from Claude Code" : ""}`}
      />
      {copilot ? (
        <span className="flex shrink-0 items-center gap-1 font-medium text-accent" title="The copilot runs the whole board">
          <Icon name="sparkles" size={10} />
          whole board
        </span>
      ) : (
        <span className="truncate font-medium text-muted" title={card.cwd}>{folderName(card.cwd)}</span>
      )}
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
      {marks}
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
  );
}

// The CLI's chip, coloured by CLI; given a card, it names the model and effort the thread runs on instead.
export function BackendBadge({ backend, card }: { backend: Card["backend"]; card?: Card }) {
  const { model, effort } = card ? runningOn(card) : {};
  const label = model ? [modelLabel(model), effort].filter(Boolean).join(" · ") : backend;
  const tone = backend === "puku" ? "bg-puku-soft text-puku" : "bg-claude-soft text-claude";
  const badge = <span className={`shrink-0 whitespace-nowrap rounded px-1.5 py-px text-[11px] font-medium ${tone}`}>{label}</span>;
  if (!model) return badge;
  const cli = backend === "puku" ? "puku-cli" : "Claude Code";
  const how = card?.effort ? "" : " (the CLI's default)";
  return <Tip text={`${cli} · ${model}${effort ? ` · ${effort} effort${how}` : ""}`}>{badge}</Tip>;
}

// A clickable version for the thread header. Click the chip, pick the other CLI, and the next turn
// runs there. No replay by default — that's the rate-limit banner's job (and it always replays).
// Lives in components/BackendPicker.tsx; re-exported here so existing import sites keep working.
export { default as BackendPicker } from "./BackendPicker";

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

// Whether the card has a progress line: a stage or what's left, and in Done only what's left.
function showsProgress(card: Card) {
  // In Done, "Done" says nothing the column doesn't.
  if (card.column === "done" && (stageStep(card.stage) === STAGES.length || !card.remaining)) return false;
  return Boolean(card.stage || card.remaining);
}

// How far along the card is (the BOARD STATUS stage) and what's left, on one line; marks (the issue and
// tags) go at its end, so they don't crowd the footer.
function Progress({ card, marks }: { card: Card; marks: React.ReactNode }) {
  const step = stageStep(card.stage);
  const tone = TONE[card.column];
  return (
    <div className="mt-2 flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px]">
      {step > 0 && (
        <span className="flex shrink-0 gap-[2px]" title={`${card.stage}: step ${step} of ${STAGES.length}`} aria-hidden>
          {STAGES.map((s, i) => (
            <span key={s} className={`h-[5px] w-[5px] rounded-full ${i < step ? tone.bar : "bg-line-strong"}`} />
          ))}
        </span>
      )}
      {card.stage && <span className={`max-w-[50%] shrink-0 truncate font-medium ${tone.text}`}>{card.stage}</span>}
      {card.remaining && card.remaining !== "none" && (
        <span className="min-w-0 shrink-[10] truncate text-faint" title={`Left: ${card.remaining}`}>· {card.remaining}</span>
      )}
      <span className="ml-auto flex shrink-0">{marks}</span>
    </div>
  );
}

// "Run on <other CLI>" — the one-click escape from a rate-limit error. Sits under the error line
// on a rate-limited card; flips the card's backend and replays the last user message.
function RateLimitSwitch({ card }: { card: Card }) {
  if (!card.rateLimitHit) return null;
  const other = card.backend === "puku" ? "claude" : "puku";
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        void api.switchBackend(card.id, other, true).catch(() => {});
      }}
      className="mt-2 rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-on-accent hover:opacity-90"
    >
      Run on {other === "puku" ? "puku-cli" : "Claude Code"}
    </button>
  );
}

// Stopped in Needs you because the CLI is logged out (no permission request): the card offers Log in.
function waitsForLogin(card: Card) {
  return card.column === "needs_you" && !card.pending && /^Log in to /.test(card.lastLine ?? "");
}

// The border says a lot: selection, unseen, or needs-you's amber. Extracted to keep CardView's complexity in check.
function cardBorder(card: Card, selected: boolean, unseen: boolean) {
  if (selected) return "border-accent ring-1 ring-accent";
  if (unseen) return "border-accent/70 ring-1 ring-accent/40 card-unseen";
  return card.column === "needs_you" ? "border-warn/60" : "border-line hover:border-line-strong";
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
  onStar,
  onTag,
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
  // The ☆: star or unstar the card (api.mark).
  onStar?: () => void;
  // A click on one of its tag pills: the board filters to that tag.
  onTag?: (tag: string) => void;
  // Other busy cards in this folder (lib/overlap.ts busyHere); flagged only while this one is busy too.
  alsoHere?: Card[];
}) {
  // The request already answered here, so a second click can't answer it (or the next one) again.
  const [answeredId, setAnsweredId] = useState<string | null>(null);
  const live = isLive(card);
  // The copilot opens like any card but can't be moved, starred or filed under a project.
  const copilot = card.role === "copilot";
  // A running card is placed by its status line; one waiting on you (a question or a permission) can still be dragged.
  const fixed = card.column === "running" || copilot;
  // The issue and tags sit on the progress line, or in the footer when the card has none.
  const marks = <CardMarks card={card} onTag={onTag} />;
  const progress = showsProgress(card);
  const answered = answeredId !== null && answeredId === card.pending?.id;
  const needsLogin = waitsForLogin(card);
  const border = cardBorder(card, selected, unseen);

  function answer(allow: boolean) {
    if (!card.pending || answered) return;
    setAnsweredId(card.pending.id);
    onAnswer(allow);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={!fixed}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", card.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      data-card-id={card.id}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      className={`group relative rounded-lg border bg-card px-3 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${border} ${fixed ? "" : "cursor-grab active:cursor-grabbing"}`}
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
          <RateLimitSwitch card={card} />
        </div>
        <CardPicture card={card} />
      </div>
      {progress && <Progress card={card} marks={marks} />}

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

      <RestartButton card={card} onResume={onResume} />

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

      {card.pending && !card.pending.questions && (
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
        <FooterMeta card={card} now={now} alsoHere={alsoHere} marks={progress ? null : marks} />
        <ContinueButton card={card} onResume={onResume} />
        {!copilot && <StarButton variant="card" starred={Boolean(card.starred)} onClick={onStar} />}
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
