"use client";

import { useState } from "react";
import type { Stitch } from "@/lib/game";
import type { Attribute } from "@/lib/game-attributes";

// The builder card's radar: one spoke per attribute, 0 at the center and 100 at the rim.
export function Radar({ attrs, size = 220 }: { attrs: Attribute[]; size?: number }) {
  const r = size / 2 - 34;
  const point = (i: number, len: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / attrs.length;
    return [Math.cos(a) * len, Math.sin(a) * len] as const;
  };
  const ring = (k: number) => attrs.map((_, i) => point(i, r * k).join(",")).join(" ");
  return (
    <svg viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} width={size} height={size} role="img" aria-label="Attributes">
      {[0.25, 0.5, 0.75, 1].map((k) => (
        <polygon key={k} points={ring(k)} fill="none" stroke="var(--line)" />
      ))}
      {attrs.map((a, i) => {
        const [x, y] = point(i, r);
        const [lx, ly] = point(i, r + 18);
        return (
          <g key={a.id}>
            <line x1={0} y1={0} x2={x} y2={y} stroke="var(--line)" />
            <text x={lx} y={ly + 4} textAnchor="middle" fontSize={11}>
              {a.icon}
            </text>
          </g>
        );
      })}
      <polygon
        points={attrs.map((a, i) => point(i, (r * a.value) / 100).join(",")).join(" ")}
        fill="color-mix(in srgb, var(--warn) 28%, transparent)"
        stroke="var(--warn)"
        strokeWidth={1.5}
      />
    </svg>
  );
}

const TONES = ["var(--sunken)", "color-mix(in srgb, var(--warn) 30%, var(--sunken))", "color-mix(in srgb, var(--warn) 55%, var(--sunken))", "color-mix(in srgb, var(--warn) 78%, var(--sunken))", "var(--warn)"];

function stitchTip(s: Stitch) {
  if (s.tone === -1) return `${s.day}: a streak freeze covered this day`;
  return `${s.day}: ${s.xp ? `${s.xp} XP` : "nothing"}`;
}

// The activity heatmap drawn as woven cloth: a column per week, a row per weekday, and each day a
// stitch that runs across or down by turns, like weft over warp. Brighter means more XP that day.
// Native titles don't show in the desktop app, so the hovered day reads out under the cloth.
export function Cloth({ stitches }: { stitches: Stitch[] }) {
  const [hover, setHover] = useState<Stitch | null>(null);
  const cell = 11;
  const weeks = Math.ceil(stitches.length / 7);
  return (
    <div className="flex flex-col gap-1" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${weeks * cell} ${7 * cell}`} width="100%" style={{ maxWidth: weeks * cell * 1.6 }} role="img" aria-label="Activity cloth">
        {stitches.map((s, i) => {
          const col = Math.floor(i / 7);
          const row = i % 7;
          const across = (col + row) % 2 === 0;
          const fill = s.tone === -1 ? "var(--accent-soft)" : TONES[s.tone] ?? TONES[0];
          return (
            <rect
              key={s.day}
              x={col * cell + (across ? 0.5 : 2.5)}
              y={row * cell + (across ? 2.5 : 0.5)}
              width={across ? cell - 1 : cell - 5}
              height={across ? cell - 5 : cell - 1}
              rx={2}
              fill={fill}
              stroke={s.tone === -1 ? "var(--accent)" : "none"}
              strokeWidth={0.6}
              onMouseEnter={() => setHover(s)}
            />
          );
        })}
      </svg>
      <span className="h-4 text-[11px] text-muted">{hover ? stitchTip(hover) : "Each stitch is a day; brighter means more shipped."}</span>
    </div>
  );
}

// A thin progress bar with a label on each side.
export function Bar({ value, max, left, right }: { value: number; max: number; left: React.ReactNode; right: React.ReactNode }) {
  const pct = max > 0 ? Math.min(100, (100 * value) / max) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-[11.5px] text-muted">
        <span>{left}</span>
        <span className="tabular-nums">{right}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
        <div className="h-full rounded-full bg-warn" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
