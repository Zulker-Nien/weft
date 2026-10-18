"use client";

import type { KindShare, ServicesSummary as Summary } from "@/lib/services-summary";
import { KIND_TONE } from "@/lib/services-summary";

// The top of the Services drawer: what everything Weft started uses out of this Mac, a bar each for
// CPU and memory split by kind (the empty part is headroom), and the service using the most.
export default function ServicesSummary({ summary }: { summary: Summary }) {
  const { kinds, busiest, biggest } = summary;
  return (
    <div className="flex flex-col gap-1.5 border-b border-line px-3 pt-1 pb-2 text-[11px] text-muted">
      {kinds.length > 0 && (
        <>
          <Bar name="CPU" kinds={kinds} pick={(k) => k.cpuPct} />
          <Bar name="Memory" kinds={kinds} pick={(k) => k.memPct} />
          <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
            {kinds.map((k) => (
              <li key={k.kind} className="flex items-center gap-1" title={`${k.count} ${k.count === 1 ? "service" : "services"}`}>
                <span className={`size-1.5 rounded-full ${KIND_TONE[k.kind]}`} />
                <span className="text-ink">{k.label}</span>
                <span className="tabular-nums">{k.usage}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {busiest && <Top name="Busiest" {...busiest} />}
      {biggest && <Top name="Most memory" {...biggest} />}
    </div>
  );
}

function Bar({ name, kinds, pick }: { name: string; kinds: KindShare[]; pick: (k: KindShare) => number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0">{name}</span>
      <div role="img" aria-label={`${name} by kind`} className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
        {kinds.map((k) => (
          <span key={k.kind} className={KIND_TONE[k.kind]} style={{ width: `${pick(k)}%` }} title={`${k.label}: ${k.usage}`} />
        ))}
      </div>
    </div>
  );
}

function Top({ name, label, usage }: { name: string; label: string; usage: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="shrink-0">{name}:</span>
      <span className="min-w-0 flex-1 truncate text-ink" title={label}>{label}</span>
      <span className="shrink-0 font-mono text-[10.5px] tabular-nums">{usage}</span>
    </div>
  );
}
