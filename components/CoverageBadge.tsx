"use client";

import { useEffect, useState } from "react";
import type { Coverage, CoverageReport } from "@/lib/coverage";
import { folderName, timeAgo } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import Tip from "./Tip";

const R = 6;
const C = 2 * Math.PI * R;
const METRICS: (keyof Coverage)[] = ["lines", "statements", "functions", "branches"];

function tone(pct: number) {
  return pct >= 80 ? "text-ok" : pct >= 50 ? "text-warn" : "text-danger";
}

function Pie({ pct }: { pct: number }) {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" className="-rotate-90">
      <circle cx={8} cy={8} r={R} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={4} />
      <circle cx={8} cy={8} r={R} fill="none" stroke="currentColor" strokeWidth={4} strokeDasharray={`${(C * pct) / 100} ${C}`} />
    </svg>
  );
}

function Breakdown({ cov }: { cov: CoverageReport }) {
  const now = useNow();
  return (
    <span className="flex w-[220px] flex-col gap-1.5">
      <span>
        <b>Test coverage</b> of <b>{folderName(cov.root)}</b>
      </span>
      {METRICS.map((k) => (
        <span key={k} className="flex items-center gap-2">
          <span className="w-[62px] capitalize text-muted">{k}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
            <span className={`block h-full rounded-full bg-current ${tone(cov[k])}`} style={{ width: `${cov[k]}%` }} />
          </span>
          <span className={`w-[38px] text-right tabular-nums ${tone(cov[k])}`}>{Math.round(cov[k])}%</span>
        </span>
      ))}
      <span className="text-muted">
        Measured {timeAgo(cov.measuredAt, now)}. Run <code>npm run coverage</code> to refresh.
      </span>
    </span>
  );
}

// "49% coverage" with a pie, for the project in view (the open card's folder, else the selected
// project). Hover for the breakdown; without a report, a button that starts a thread to set it up.
export default function CoverageBadge({ cwd, onSetup }: { cwd?: string | null; onSetup: (cwd: string) => void }) {
  // Keyed by folder, so switching projects never shows the last one's numbers.
  const [loaded, setLoaded] = useState<{ cwd: string; cov: CoverageReport | null } | null>(null);
  // Folders a setup thread was started for this session, so one click can't start two.
  const [started, setStarted] = useState<string[]>([]);

  useEffect(() => {
    if (!cwd) return;
    let live = true;
    // Re-read on focus too, so a fresh `npm run coverage` shows up without a reload.
    const load = () =>
      fetch(`/api/coverage?cwd=${encodeURIComponent(cwd)}`)
        .then((r) => r.json())
        .then((d: { coverage: CoverageReport | null }) => live && setLoaded({ cwd, cov: d.coverage }))
        .catch(() => {});
    load();
    window.addEventListener("focus", load);
    return () => {
      live = false;
      window.removeEventListener("focus", load);
    };
  }, [cwd]);

  if (!cwd || !loaded || loaded.cwd !== cwd) return null;
  const cov = loaded.cov;
  // No report: a button that starts a thread to set coverage up, so the badge never just vanishes.
  if (!cov) {
    const busy = started.includes(cwd);
    return (
      <Tip
        text={
          <span className="flex w-[220px] flex-col gap-1">
            <span>
              <b>No test coverage</b> for <b>{folderName(cwd)}</b> yet.
            </span>
            <span className="text-muted">
              {busy
                ? "A thread is setting it up. This fills in once coverage/coverage-summary.json exists."
                : "Click to start a thread that adds a test runner with coverage (/weft:setup-done) and runs it once."}
            </span>
          </span>
        }
      >
        <button
          disabled={busy}
          onClick={() => {
            setStarted((s) => [...s, cwd]);
            onSetup(cwd);
          }}
          className="flex items-center gap-1 rounded-md border border-dashed border-line-strong px-1.5 py-0.5 text-[12px] text-muted hover:border-accent hover:text-accent disabled:cursor-default disabled:hover:border-line-strong disabled:hover:text-muted"
        >
          <Pie pct={0} />
          {busy ? "Setting up coverage…" : "Set up coverage"}
        </button>
      </Tip>
    );
  }
  const pct = Math.round(cov.lines);

  return (
    <Tip text={<Breakdown cov={cov} />}>
      <span className={`flex items-center gap-1 text-[12px] ${tone(pct)}`}>
        <Pie pct={pct} />
        {pct}%<span className="text-muted">coverage</span>
      </span>
    </Tip>
  );
}
