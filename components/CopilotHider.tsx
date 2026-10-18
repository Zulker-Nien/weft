"use client";

// The copilot lane's hidden state: the 36px pill on the right edge, and the persona's avatar the
// header shares with it.
import { useEffect, useRef } from "react";
import { laneDigest } from "@/lib/copilot-lane";
import { personaOf, type PersonaInfo } from "@/lib/copilot-personas";
import type { Card } from "@/lib/types";

// The persona's face, cropped from its picture (Wingman's: the hovercaddy cockpit, the copilot beside you).
export function Avatar({ size, picture }: { size: number; picture: PersonaInfo["picture"] }) {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 rounded-full border-2 border-accent"
      style={{ width: size, height: size, background: `url(${picture.src}) ${picture.avatar}` }}
    />
  );
}

// The 36px pill pinned to the right edge: avatar, needs-you dot, count, rotated "Copilot" label. Resting
// the mouse on it for PEEK_DELAY_MS peeks (a pass on the way to the window edge doesn't); click opens the chat.
export const PEEK_DELAY_MS = 350;

export default function CopilotHider(props: {
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
  const persona = personaOf(props.card?.persona);
  const peekTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(peekTimer.current), []);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        window.clearTimeout(peekTimer.current);
        props.onOpen();
      }}
      onMouseEnter={() => {
        window.clearTimeout(peekTimer.current);
        peekTimer.current = window.setTimeout(props.onPeek, PEEK_DELAY_MS);
      }}
      onMouseLeave={() => window.clearTimeout(peekTimer.current)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onOpen();
        }
      }}
      title={`Open the copilot (${persona.name}) — ${props.toggleTip}`}
      aria-label={`Open the copilot${news > 0 ? ` (${news} new)` : ""}`}
      className="group flex h-full cursor-pointer flex-col items-center gap-2 px-1 py-3 hover:bg-sunken/80 focus:bg-sunken/80 focus:outline-none"
    >
      <div className="relative">
        <Avatar size={26} picture={persona.picture} />
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
