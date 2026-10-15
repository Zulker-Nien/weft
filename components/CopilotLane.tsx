"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { COCKPIT, LANE_WIDTH, type LaneState, laneDigest } from "@/lib/copilot-lane";
import { isLive } from "@/lib/format";
import { COPILOT_ID, type Card } from "@/lib/types";
import { useCopilotThread } from "@/lib/use-copilot-thread";
import CopilotEmpty from "./CopilotEmpty";
import CrashGuard from "./CrashGuard";
import Icon, { Spinner } from "./Icon";
import ThreadView from "./ThreadView";

function Avatar({ size }: { size: number }) {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 rounded-full border-2 border-accent"
      style={{ width: size, height: size, background: `url(${COCKPIT.src}) ${COCKPIT.face} / 520%` }}
    />
  );
}

function Status({ card }: { card: Card | null }) {
  if (!card) return <span className="text-[11px] text-faint">Starting…</span>;
  if (card.column === "running") {
    return (
      <span className="flex items-center gap-1 text-[11px] text-accent">
        <Spinner size={9} /> Working
      </span>
    );
  }
  if (card.column === "needs_you") return <span className="text-[11px] text-warn">Needs you</span>;
  return <span className="text-[11px] text-muted">{card.warm ? "Ready" : "Idle"}</span>;
}

// The copilot's lane on the right of the board. Three states, like Intercom's hider: hidden is a 36px
// pill pinned to the right edge, peek is the 236px digest column, open is the 520px chat over the
// cockpit. The hider pill hovers into peek; the copilot needing you auto-expands into peek; ⌘J
// cycles hidden → peek → open → hidden.
export default function CopilotLane(props: {
  state: LaneState;
  cards: Card[];
  onOpenCard: (card: Card) => void;
  onHide: () => void;
  onPeek: () => void;
  onOpen: () => void;
  toggleTip: string;
}) {
  const { card, items, streaming, error, fail, send, newChat } = useCopilotThread();
  const live = card ? isLive(card) : false;

  if (props.state === "hidden") {
    return (
      <aside
        data-copilot-lane="hidden"
        style={{ width: LANE_WIDTH.hidden }}
        className="shrink-0 self-stretch border-l border-line-strong bg-sunken"
      >
        <Hider
          card={card}
          cards={props.cards}
          items={items}
          onPeek={props.onPeek}
          onOpen={props.onOpen}
          toggleTip={props.toggleTip}
        />
      </aside>
    );
  }

  const isOpen = props.state === "open";

  const header = (
    <header className="relative flex shrink-0 items-center gap-2 px-2.5 py-2">
      <Avatar size={isOpen ? 30 : 26} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-[13px] font-semibold text-ink">Copilot</div>
        <Status card={card} />
      </div>
      {isOpen && live && (
        <button
          onClick={() => void api.stop(COPILOT_ID).catch(fail)}
          className="flex items-center gap-1 rounded-md bg-black/30 px-2 py-1 text-[11.5px] text-ink hover:bg-black/50"
        >
          <Icon name="stop" size={11} /> Stop
        </button>
      )}
      {isOpen && (
        <button
          onClick={() => void newChat().catch(fail)}
          title="Start a new conversation"
          className="rounded-md bg-black/30 px-2 py-1 text-[11.5px] text-ink hover:bg-black/50"
        >
          New chat
        </button>
      )}
      <button
        onClick={props.onHide}
        title={`Hide — ${props.toggleTip}`}
        aria-label="Hide the copilot"
        className="grid h-6 w-6 place-items-center rounded-md bg-black/30 text-muted hover:bg-black/50 hover:text-ink"
      >
        <Icon name="chevronRight" size={13} />
      </button>
    </header>
  );

  if (!isOpen) {
    return (
      <aside
        data-copilot-lane="peek"
        style={{ width: LANE_WIDTH.peek }}
        className="flex shrink-0 flex-col border-l border-line-strong bg-sunken"
      >
        {header}
        <Peek
          cards={props.cards}
          items={items}
          error={error}
          onHide={props.onHide}
          onOpen={props.onOpen}
          onOpenCard={props.onOpenCard}
          onAsk={(text) => {
            props.onOpen();
            send(text).catch(fail);
          }}
        />
      </aside>
    );
  }

  return (
    <aside
      data-copilot-lane="open"
      style={{ width: LANE_WIDTH.open }}
      className="relative flex shrink-0 flex-col overflow-hidden border-l border-line-strong bg-canvas"
    >
      {/* The cockpit fills the top and fades into the canvas, so the conversation below stays readable. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[78%]"
        style={{ background: `url(${COCKPIT.src}) 75% 30% / cover` }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgb(10 8 8 / 0.55) 0, rgb(10 8 8 / 0) 12%, rgb(10 8 8 / 0) 24%, var(--canvas) 54%, var(--canvas) 100%)",
        }}
      />
      {header}
      {/* A window onto the cockpit above the conversation. */}
      <div className="h-[26%] shrink-0" />
      {error && <p className="relative mx-3 rounded-md bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</p>}
      {card ? (
        // Older messages fade out as they scroll up into the cockpit, rather than run over the copilot.
        <div className="relative flex min-h-0 flex-1 flex-col [mask-image:linear-gradient(to_bottom,transparent,black_14%)]">
          <CrashGuard what="conversation" className="m-3">
            <ThreadView
              card={card}
              items={items}
              streaming={streaming}
              onSend={send}
              onAnswer={(allow, answers) => void api.answer(COPILOT_ID, allow, answers, card.pending?.id).catch(fail)}
              placeholder="Ask about your threads, or tell me what to start"
              empty={<CopilotEmpty onAsk={(text) => void send(text).catch(fail)} />}
            />
          </CrashGuard>
        </div>
      ) : (
        <div className="relative flex flex-1 items-center justify-center text-faint">
          <Spinner size={16} />
        </div>
      )}
    </aside>
  );
}

// The 36px pill pinned to the right edge: avatar, needs-you dot, count, rotated "Copilot" label. Hover
// (or having news) auto-expands into peek; click opens the chat.
function Hider(props: {
  card: Card | null;
  cards: Card[];
  items: Parameters<typeof laneDigest>[1];
  onPeek: () => void;
  onOpen: () => void;
  toggleTip: string;
}) {
  // The peeking digest, the same one the peek column shows, so the hider knows what to glance at.
  const digest = laneDigest(props.cards, props.items);
  const waiting = digest.needsYou.length;
  const news = waiting + digest.finished;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onOpen();
        }
      }}
      title={`Open the copilot — ${props.toggleTip}`}
      aria-label={`Open the copilot${news > 0 ? ` (${news} new)` : ""}`}
      className="group flex h-full cursor-pointer flex-col items-center gap-2 px-1 py-3 hover:bg-sunken/80 focus:bg-sunken/80 focus:outline-none"
    >
      <div className="relative">
        <Avatar size={26} />
        {waiting > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-warn ring-2 ring-sunken"
            title="The copilot needs you"
          />
        )}
      </div>
      {news > 0 && (
        <span
          aria-hidden="true"
          className="rounded-full bg-warn px-1.5 text-[10px] font-bold leading-4 text-[#1a1410] tabular-nums"
        >
          {news}
        </span>
      )}
      <span className="mt-auto select-none text-[10.5px] font-medium uppercase tracking-wider text-muted group-hover:text-ink [writing-mode:vertical-rl]">
        Copilot
      </span>
    </div>
  );
}

function Peek(props: {
  cards: Card[];
  items: Parameters<typeof laneDigest>[1];
  error: string | null;
  onHide: () => void;
  onOpen: () => void;
  onOpenCard: (card: Card) => void;
  onAsk: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const digest = laneDigest(props.cards, props.items);
  const waiting = digest.needsYou.length;

  // The peek is the kind of pane you glance at, then look away. Auto-close 6s after the mouse leaves
  // the peek, so the board reclaims the 236px without you having to find the ×.
  const [armed, setArmed] = useState(true);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(props.onHide, 6000);
    return () => window.clearTimeout(id);
  }, [armed, props.onHide]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2"
      onMouseEnter={() => setArmed(false)}
      onMouseLeave={() => setArmed(true)}
    >
      {props.error && <p className="rounded-md bg-danger-soft px-2 py-1.5 text-[11.5px] text-danger">{props.error}</p>}
      <div className="rounded-lg border border-accent/30 bg-accent-soft px-2.5 py-2 text-[12px] leading-snug text-ink">
        <span className="font-semibold text-accent">Since you last asked:</span> {digest.finished} finished
        {waiting > 0 ? `, ${waiting} need${waiting === 1 ? "s" : ""} you` : ", nothing waiting on you"}.
      </div>
      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
        {digest.needsYou.slice(0, 3).map((card) => (
          <button
            key={card.id}
            onClick={() => props.onOpenCard(card)}
            className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-left text-[12px] leading-snug text-ink hover:border-line-strong"
          >
            <span className="font-semibold text-warn">Needs you:</span> {card.title}
          </button>
        ))}
        {digest.lastReply && (
          <button
            onClick={props.onOpen}
            className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-left text-[12px] leading-snug text-muted hover:border-line-strong"
          >
            <span className="font-semibold text-ink">Copilot:</span> {digest.lastReply}
          </button>
        )}
      </div>
      <button
        onClick={props.onOpen}
        className="relative mt-auto h-[150px] shrink-0 overflow-hidden rounded-lg border border-line-strong text-left"
        style={{ background: `url(${COCKPIT.src}) 78% 38% / 260%` }}
      >
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2.5 pb-1.5 pt-5 text-[11.5px] font-semibold text-white">
          Open the cockpit
        </span>
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft.trim();
          if (!text) return;
          setDraft("");
          props.onAsk(text);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setArmed(false)}
          placeholder="Ask the copilot…"
          className="w-full rounded-lg border border-line-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
        />
      </form>
    </div>
  );
}
