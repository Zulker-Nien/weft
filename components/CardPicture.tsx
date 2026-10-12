"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { monogram } from "@/lib/card-pictures";
import { currentArea, placeBeside } from "@/lib/float-place";
import { folderName } from "@/lib/format";
import type { Card } from "@/lib/types";

// The card's latest picture beside its title, bigger on hover; a card with none shows its emoji
// (or its folder's initial until Haiku picks one) in a small tile instead.
export default function CardPicture({ card }: { card: Card }) {
  const [hover, setHover] = useState<DOMRect | null>(null);
  const [broken, setBroken] = useState<string | null>(null);
  const done = card.column === "done";
  if (!card.thumb || broken === card.thumb) {
    return (
      <span
        aria-hidden
        className={`grid size-7 shrink-0 place-items-center rounded-md bg-sunken text-[15px] leading-none ${card.emoji ? "" : "text-[12px] font-semibold text-faint"} ${done ? "opacity-60" : ""}`}
      >
        {card.emoji ?? monogram(folderName(card.cwd))}
      </span>
    );
  }
  const count = card.pictures ?? 0;
  return (
    <span
      className="relative mt-0.5 size-[52px] shrink-0 cursor-zoom-in"
      onMouseEnter={(e) => setHover(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setHover(null)}
    >
      <img
        src={card.thumb}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setBroken(card.thumb ?? null)}
        className={`size-full rounded-md border border-line object-cover object-left-top ${done ? "opacity-70 grayscale-[40%]" : ""}`}
      />
      {count > 1 && (
        <span className="absolute -bottom-1 -right-1 rounded-full border-[1.5px] border-card bg-ink px-1 text-[9px] font-semibold leading-[13px] text-canvas">
          {count}
        </span>
      )}
      {hover &&
        createPortal(
          <img
            src={card.thumb}
            alt=""
            className="pointer-events-none fixed z-50 max-h-[300px] w-[420px] rounded-lg border border-line-strong bg-card object-cover object-left-top shadow-2xl"
            style={placeBeside(hover, { width: 420, height: 300 }, currentArea())}
          />,
          document.body,
        )}
    </span>
  );
}
