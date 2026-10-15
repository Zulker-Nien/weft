"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { COCKPIT, LANE_WIDTH, laneDigest } from "@/lib/copilot-lane";
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

// The copilot's lane on the right of the board. Minimized it's a column: what needs you, what finished
// since you last asked, its latest reply, a peek into the cockpit and an ask box. Open, it's the chat
// over the cockpit: you in the driver's seat of a hovercaddy, the copilot beside you.
export default function CopilotLane(props: {
  open: boolean;
  onToggle: () => void;
  cards: Card[];
  onOpenCard: (card: Card) => void;
  toggleTip: string;
}) {
  const { card, items, streaming, error, fail, send, newChat } = useCopilotThread();
  const live = card ? isLive(card) : false;

  const header = (
    <header className="relative flex shrink-0 items-center gap-2 px-2.5 py-2">
      <Avatar size={props.open ? 30 : 26} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-[13px] font-semibold text-ink">Copilot</div>
        <Status card={card} />
      </div>
      {props.open && live && (
        <button
          onClick={() => void api.stop(COPILOT_ID).catch(fail)}
          className="flex items-center gap-1 rounded-md bg-black/30 px-2 py-1 text-[11.5px] text-ink hover:bg-black/50"
        >
          <Icon name="stop" size={11} /> Stop
        </button>
      )}
      {props.open && (
        <button
          onClick={() => void newChat().catch(fail)}
          title="Start a new conversation"
          className="rounded-md bg-black/30 px-2 py-1 text-[11.5px] text-ink hover:bg-black/50"
        >
          New chat
        </button>
      )}
      <button
        onClick={props.onToggle}
        title={props.open ? `Minimize — ${props.toggleTip}` : `Open — ${props.toggleTip}`}
        aria-label={props.open ? "Minimize the copilot" : "Open the copilot"}
        className="grid h-6 w-6 place-items-center rounded-md bg-black/30 text-muted hover:bg-black/50 hover:text-ink"
      >
        <Icon name={props.open ? "chevronRight" : "chevronLeft"} size={13} />
      </button>
    </header>
  );

  if (!props.open) {
    return (
      <aside
        data-copilot-lane="minimized"
        style={{ width: LANE_WIDTH.minimized }}
        className="flex shrink-0 flex-col border-l border-line-strong bg-sunken"
      >
        {header}
        <Minimized cards={props.cards} items={items} error={error} onOpen={props.onToggle} onOpenCard={props.onOpenCard} onAsk={(text) => {
          props.onToggle();
          send(text).catch(fail);
        }} />
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

function Minimized(props: {
  cards: Card[];
  items: Parameters<typeof laneDigest>[1];
  error: string | null;
  onOpen: () => void;
  onOpenCard: (card: Card) => void;
  onAsk: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const digest = laneDigest(props.cards, props.items);
  const waiting = digest.needsYou.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2">
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
          placeholder="Ask the copilot…"
          className="w-full rounded-lg border border-line-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
        />
      </form>
    </div>
  );
}
