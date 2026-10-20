"use client";

import { cardTags } from "@/lib/rail-view";
import { runningBadge } from "@/lib/tasks-view";
import { formatAt } from "@/lib/schedule";
import type { Card } from "@/lib/types";
import TagPill from "./TagPill";
import Tip from "./Tip";

// The card's running subagents (a count), its GitHub issue (#N, a link) and up to two tags with "+N" for the rest,
// folded into the footer line. Also shows "Auto-resumed" when lib/limit-resume.ts replayed the last user
// message because the 15-min limit poll saw the window reset.
export default function CardMarks({ card, onTag }: { card: Card; onTag?: (tag: string) => void }) {
  const { shown, more } = cardTags(card.tags);
  const tasks = runningBadge(card.tasks);
  if (!card.issue && !shown.length && !tasks && !card.autoResumedAt) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {tasks && (
        <Tip text={tasks.title}>
          <span className="shrink-0 font-medium text-accent">⑂{tasks.count}</span>
        </Tip>
      )}
      {card.issue && (
        <a
          href={card.issue.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={`${card.issue.repo}#${card.issue.number} (${card.issue.state})`}
          className={`shrink-0 font-medium hover:underline ${card.issue.state === "closed" ? "text-faint line-through" : "text-muted"}`}
        >
          #{card.issue.number}
        </a>
      )}
      {card.autoResumedAt && (
        <Tip text={`This thread restarted on its own after the ${card.backend} limit reset.`}>
          <span className="shrink-0 rounded-md border border-accent/40 px-1.5 py-px text-[11px] font-medium text-accent">
            Auto-resumed · {formatAt(card.autoResumedAt)}
          </span>
        </Tip>
      )}
      {shown.map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={(e) => {
            if (!onTag) return;
            e.stopPropagation();
            onTag(tag);
          }}
          className="flex shrink-0"
          tabIndex={onTag ? 0 : -1}
        >
          <TagPill tag={tag} className="max-w-[60px]" title={onTag ? `#${tag} · show only this tag` : undefined} />
        </button>
      ))}
      {more > 0 && (
        <span className="shrink-0" title={(card.tags ?? []).slice(2).join(", ")}>
          +{more}
        </span>
      )}
    </span>
  );
}
