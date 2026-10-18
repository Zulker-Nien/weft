"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { onTopTurn, pulse, scrollToTurn } from "@/lib/show-events";
import { isLive } from "@/lib/format";
import { showMinis, type Dot, type Mini, type Visit } from "@/lib/show-rail";
import type { Card, ThreadItem } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import Icon from "./Icon";

const DOT: Record<Exclude<Dot, "page">, string> = { ok: "bg-ok", wait: "bg-warn", err: "bg-danger", usr: "bg-faint" };
const LABEL: Record<Dot, string> = { ok: "Finished", wait: "Waiting", err: "Failed", usr: "You", page: "Page" };

// Pages you opened in the pane by hand, per card, for this session only (the thread records the agent's).
const visits = new Map<string, Visit[]>();
const listeners = new Set<() => void>();
const NONE: Visit[] = [];
function recordVisit(card: string, url: string) {
  visits.set(card, [...(visits.get(card) ?? NONE), { url, at: Date.now() }]);
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function Marker({ mini, onScreen }: { mini: Mini; onScreen: boolean }) {
  if (mini.dot === "page")
    return (
      <span aria-label={onScreen ? "Page on screen" : LABEL.page} className={`mb-[3px] shrink-0 ${onScreen ? "text-accent" : "text-muted"}`}>
        <Icon name="globe" size={9} />
      </span>
    );
  return <span className={`mb-[3px] size-[7px] shrink-0 rounded-full ${DOT[mini.dot]}`} aria-label={LABEL[mini.dot]} />;
}

// The 72 px column right of the browser pane's page: one mini per turn of the open thread and per page
// the pane showed, oldest first with the newest at the bottom, like the chat. Click a turn and the chat scrolls to it; click a page and the pane opens
// it again too, and a turn puts the pane back on the page it showed. Scroll the chat and the turn at its top lights up here.
// Hidden under 980 px of window, so the chat keeps its room on a 13" Air (docs/architecture/show-rail.md).
// card is the open thread (none: no rail); hidden while the New thread dialog takes its place; pageUrl is the pane's page.
export default function ShowRail({ card, hidden, items, pageUrl }: { card: Card | null | undefined; hidden: boolean; items: ThreadItem[]; pageUrl: string }) {
  const now = useNow();
  // The turn on top of the chat, per card, so switching cards starts with none marked.
  const [top, setTop] = useState<{ card?: string; id: string }>();
  const cardId = card?.id;
  const list = useRef<HTMLDivElement>(null);
  const cardVisits = useSyncExternalStore(subscribe, () => visits.get(cardId ?? "") ?? NONE, () => NONE);
  // The page last seen and a page the rail itself reopened, which isn't a new visit.
  const seen = useRef<{ card?: string; url: string }>(undefined);
  const reopened = useRef<string>(undefined);
  // Newest is at the bottom, like the chat: follow it down unless you've scrolled up to look back.
  const follow = useRef(true);
  const count = card && !hidden ? items.length : 0;
  useEffect(() => {
    const el = list.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [count, cardVisits, cardId]);

  // A new page while the same card stays open is a visit; the first page after a switch is the card's own.
  useEffect(() => {
    const last = seen.current;
    seen.current = { card: cardId, url: pageUrl };
    if (!cardId || !pageUrl || last?.card !== cardId || last.url === pageUrl) return;
    if (reopened.current === pageUrl) reopened.current = undefined;
    else recordVisit(cardId, pageUrl);
  }, [cardId, pageUrl]);

  useEffect(
    () =>
      onTopTurn((id) => {
        setTop({ card: cardId, id });
        const mini = list.current?.querySelector<HTMLElement>(`[data-mini="${CSS.escape(id)}"]`);
        mini?.scrollIntoView({ block: "nearest" });
        pulse(mini);
      }),
    [cardId],
  );

  if (!card || hidden) return null;
  const minis = showMinis(items, { live: isLive(card), now, visits: cardVisits });
  const onScreen = minis.find((m) => m.dot === "page" && m.url === pageUrl)?.id;
  const active = top?.card === card.id ? top.id : undefined;
  return (
    <aside aria-label="Show" className="flex w-[72px] shrink-0 flex-col border-l border-line bg-panel max-[979px]:hidden">
      <div className="sticky top-0 border-b border-line py-2.5 text-center text-[10px] uppercase tracking-[0.08em] text-muted">Show</div>
      <div
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1.5 py-2">
        {minis.map((m) => (
          <button
            key={m.id}
            data-mini={m.id}
            onClick={() => {
              setTop({ card: card.id, id: m.id });
              scrollToTurn(m.turn ?? m.id);
              // The pane goes back to the page on screen at that turn, if it's moved on since.
              if (m.url && m.url !== pageUrl) {
                reopened.current = m.url;
                void window.threadboard?.browser.open(m.url);
              }
            }}
            title={m.dot === "page" ? m.url : m.text}
            aria-current={m.id === active || undefined}
            className={`flex flex-col rounded-md border bg-canvas px-[7px] py-1.5 text-left text-[10px] leading-[1.3] transition hover:-translate-y-px hover:border-accent ${
              m.id === active ? "border-accent shadow-[inset_0_0_0_1px_var(--accent)]" : "border-line"
            }`}
          >
            <Marker mini={m} onScreen={m.id === onScreen} />
            <span className="line-clamp-3 break-words text-ink">{m.text}</span>
            <span className="mt-1 text-[9px] text-muted">{m.time}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
