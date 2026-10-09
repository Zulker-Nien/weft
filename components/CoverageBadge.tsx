"use client";

import { useEffect, useState } from "react";
import type { Coverage } from "@/lib/coverage";

const R = 6;
const C = 2 * Math.PI * R;

// A 14px pie of line coverage; the full breakdown is in the tooltip. Renders nothing without a report.
export default function CoverageBadge() {
  const [cov, setCov] = useState<Coverage | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/coverage")
      .then((r) => r.json())
      .then((d: { coverage: Coverage | null }) => live && setCov(d.coverage))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!cov) return null;
  const pct = Math.round(cov.lines);
  const tone = pct >= 80 ? "text-ok" : pct >= 50 ? "text-warn" : "text-danger";
  const title = `Test coverage: lines ${cov.lines}% · statements ${cov.statements}% · functions ${cov.functions}% · branches ${cov.branches}%`;

  return (
    <span title={title} className={`flex items-center gap-1 text-[12px] ${tone}`}>
      <svg width={14} height={14} viewBox="0 0 16 16" className="-rotate-90">
        <circle cx={8} cy={8} r={R} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={4} />
        <circle
          cx={8}
          cy={8}
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth={4}
          strokeDasharray={`${(C * pct) / 100} ${C}`}
        />
      </svg>
      {pct}%
    </span>
  );
}
