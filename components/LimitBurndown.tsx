"use client";

import { useEffect, useState } from "react";
import { formatReset } from "@/lib/format";
import { burndown, type Burndown, type LimitSample, type Mark, type Point } from "@/lib/limit-chart";
import type { Backend, CardStats, LimitWindow } from "@/lib/types";
import { useNow } from "@/lib/use-now";

// The burndown of the plan limits across the week, in the status strip's hover over 5hr / 7d: the
// weekly limit left in red, the 5-hour one in green; red lines where either ran out, green lines at the
// 5-hour resets (light), the next one (strong) and the weekly reset (strongest). History from /api/limits.

const W = 420;
const H = 132;
const PAD = { left: 26, right: 6, top: 6, bottom: 16 };

const MARK_STYLE: Record<Mark["kind"], { stroke: string; width: number; opacity: number }> = {
  light: { stroke: "var(--ok)", width: 1, opacity: 0.22 },
  next: { stroke: "var(--ok)", width: 1.5, opacity: 0.8 },
  week: { stroke: "var(--ok)", width: 3, opacity: 1 },
  hit: { stroke: "var(--danger)", width: 1.5, opacity: 0.9 },
};

function useSamples(backend: Backend) {
  const [samples, setSamples] = useState<LimitSample[]>([]);
  useEffect(() => {
    let live = true;
    fetch(`/api/limits?backend=${backend}`)
      .then((res) => (res.ok ? res.json() : { samples: [] }))
      .then((body: { samples?: LimitSample[] }) => live && setSamples(body.samples ?? []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [backend]);
  return samples;
}

// Local midnights inside the chart, for the day labels.
function midnights(start: number, end: number): number[] {
  const d = new Date(start);
  d.setHours(24, 0, 0, 0);
  const out: number[] = [];
  for (; d.getTime() < end; d.setDate(d.getDate() + 1)) out.push(d.getTime());
  return out;
}

function Chart({ chart }: { chart: Burndown }) {
  const x = (t: number) => PAD.left + ((t - chart.start) / (chart.end - chart.start)) * (W - PAD.left - PAD.right);
  const y = (left: number) => PAD.top + ((100 - left) / 100) * (H - PAD.top - PAD.bottom);
  const line = (points: Point[]) => points.map(([t, l]) => `${x(t).toFixed(1)},${y(l).toFixed(1)}`).join(" ");
  const bottom = H - PAD.bottom;
  const nowX = x(chart.now);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label="Plan limits burndown">
      <rect x={nowX} y={PAD.top} width={Math.max(0, W - PAD.right - nowX)} height={bottom - PAD.top} fill="var(--ink)" opacity={0.04} />
      {[100, 50, 0].map((l) => (
        <g key={l}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(l)} y2={y(l)} stroke="var(--line)" />
          <text x={PAD.left - 4} y={y(l) + 3} textAnchor="end" fontSize={9} fill="var(--faint)">{l}%</text>
        </g>
      ))}
      {midnights(chart.start, chart.end).map((t) => (
        <text key={t} x={x(t) + 2} y={H - 4} fontSize={9} fill="var(--faint)">
          {new Date(t).toLocaleDateString("en-US", { weekday: "short" })}
        </text>
      ))}
      {chart.marks.map((m) => (
        <line key={`${m.kind}${m.at}`} x1={x(m.at)} x2={x(m.at)} y1={PAD.top} y2={bottom} stroke={MARK_STYLE[m.kind].stroke}
          strokeWidth={MARK_STYLE[m.kind].width} opacity={MARK_STYLE[m.kind].opacity} />
      ))}
      <polyline points={line(chart.pace)} fill="none" stroke="var(--danger)" strokeDasharray="2 3" opacity={0.35} />
      <polyline points={line(chart.weeklyGuess)} fill="none" stroke="var(--danger)" strokeWidth={2} opacity={0.4} />
      <polyline points={line(chart.fiveHour)} fill="none" stroke="var(--ok)" strokeWidth={1.5} strokeLinejoin="round" />
      <polyline points={line(chart.weekly)} fill="none" stroke="var(--danger)" strokeWidth={2} strokeLinejoin="round" />
      <line x1={nowX} x2={nowX} y1={PAD.top} y2={bottom} stroke="var(--muted)" strokeDasharray="1 2" />
    </svg>
  );
}

function Summary({ name, window, tone, now }: { name: string; window?: LimitWindow; tone: string; now: number }) {
  if (!window) return null;
  return (
    <div>
      <span className={`font-semibold ${tone}`}>{name}</span> {Math.max(0, 100 - window.used)}% left
      {window.resetsAt && <span className="text-muted"> · resets {formatReset(window.resetsAt, now)}</span>}
    </div>
  );
}

function Key({ color, width = 1, opacity = 1, dash, label }: { color: string; width?: number; opacity?: number; dash?: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <svg width={10} height={10}>
        <line x1={5} x2={5} y1={0} y2={10} stroke={color} strokeWidth={width} opacity={opacity} strokeDasharray={dash} />
      </svg>
      {label}
    </span>
  );
}

export default function LimitBurndown({ backend = "claude", stats }: { backend?: Backend; stats: CardStats }) {
  const samples = useSamples(backend);
  const now = useNow();
  if (!now) return null;
  const chart = burndown(samples, stats, now);
  return (
    <div className="flex flex-col gap-1.5 font-sans">
      <div className="flex justify-between gap-3 text-[11.5px]">
        <Summary name="Weekly" window={stats.sevenDay} tone="text-danger" now={now} />
        <Summary name="5-hour" window={stats.fiveHour} tone="text-ok" now={now} />
      </div>
      <Chart chart={chart} />
      <div className="flex flex-wrap gap-x-3 text-[10.5px] text-muted">
        <Key color="var(--danger)" width={1.5} label="limit hit" />
        <Key color="var(--ok)" opacity={0.35} label="5-hour reset" />
        <Key color="var(--ok)" width={1.5} label="next" />
        <Key color="var(--ok)" width={3} label="weekly reset" />
        <Key color="var(--danger)" dash="2 2" opacity={0.6} label="even pace" />
        <Key color="var(--danger)" width={2} opacity={0.4} label="assumed" />
      </div>
    </div>
  );
}
