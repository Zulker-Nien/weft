import { formatCpu, formatMem } from "./services-view";
import type { MachineInfo, ServiceEntry, ServiceKind } from "./types";

// The Services drawer's summary (components/ServicesSummary.tsx): what the services use out of this
// Mac, split by what kind of thing is using it, and the one using the most. A bare "276% CPU · 7.9 GB"
// didn't say whether that was a lot, or whose it was.

export const KIND_LABELS: Record<ServiceKind, string> = {
  cli: "Threads",
  dev: "Dev servers",
  task: "Thread dev servers",
  terminal: "Terminals",
  other: "Other",
  weft: "Weft",
};

export const KIND_TONE: Record<ServiceKind, string> = {
  cli: "bg-accent",
  dev: "bg-ok",
  task: "bg-ok",
  terminal: "bg-warn",
  other: "bg-faint",
  weft: "bg-puku",
};

export interface KindShare {
  kind: ServiceKind;
  label: string;
  count: number;
  cpu: number;
  memKb: number;
  // "1.9 cores · 5.1 GB"
  usage: string;
  // Width of its slice of each bar, 0-100.
  cpuPct: number;
  memPct: number;
}

export interface ServicesSummary {
  // "2.8 of 10 cores · 7.9 of 16 GB", or "276% CPU · 7.9 GB" before the machine is known.
  headline: string;
  // The whole Mac's use, for the headline's tooltip: "28% of CPU, 49% of memory".
  share?: string;
  kinds: KindShare[];
  // "Claude Code · Fix the login page" and "120% · 2.1 GB"; the one using the most CPU.
  busiest?: { label: string; usage: string };
  // The one using the most memory, when it isn't the busiest.
  biggest?: { label: string; usage: string };
}

// 276 → "2.8"; 1,240 → "12".
function coreCount(cpu: number): string {
  const cores = cpu / 100;
  return cores < 10 ? cores.toFixed(1) : String(Math.round(cores));
}

// 276 → "2.8 cores"; one core reads "1.0 core".
export function formatCores(cpu: number): string {
  const n = coreCount(cpu);
  return `${n} ${n === "1.0" ? "core" : "cores"}`;
}

// The Mac's RAM in whole GB, as Apple sells it: "16 GB".
export function formatRam(kb: number): string {
  return `${Math.round(kb / 1024 / 1024)} GB`;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, (part / whole) * 100) : 0);

function named(s: ServiceEntry) {
  return {
    label: s.title ? `${s.label} · ${s.title}` : s.label,
    usage: `${formatCpu(s.cpu)} · ${formatMem(s.memKb)}`,
  };
}

// Biggest first; ties keep the services' own order.
function topBy(services: readonly ServiceEntry[], key: "cpu" | "memKb") {
  return services.reduce<ServiceEntry | undefined>((top, s) => (s[key] > (top?.[key] ?? 0) ? s : top), undefined);
}

export function summarize(services: readonly ServiceEntry[], machine?: MachineInfo): ServicesSummary {
  const cpu = services.reduce((n, s) => n + s.cpu, 0);
  const memKb = services.reduce((n, s) => n + s.memKb, 0);
  // Bars fill against the whole Mac, so the empty part is the headroom left.
  const cpuWhole = machine ? machine.cores * 100 : cpu;
  const memWhole = machine ? machine.memKb : memKb;

  const byKind = new Map<ServiceKind, KindShare>();
  for (const s of services) {
    if (!s.cpu && !s.memKb) continue;
    const k = byKind.get(s.kind) ?? { kind: s.kind, label: KIND_LABELS[s.kind], count: 0, cpu: 0, memKb: 0, usage: "", cpuPct: 0, memPct: 0 };
    k.count += 1;
    k.cpu += s.cpu;
    k.memKb += s.memKb;
    byKind.set(s.kind, k);
  }
  const kinds = [...byKind.values()]
    .map((k) => ({ ...k, usage: `${formatCores(k.cpu)} · ${formatMem(k.memKb)}`, cpuPct: pct(k.cpu, cpuWhole), memPct: pct(k.memKb, memWhole) }))
    .sort((a, b) => b.cpu - a.cpu || b.memKb - a.memKb);

  // Under 1% isn't busy; the memory one still shows on its own then.
  const busy = topBy(services, "cpu");
  const busiest = busy && busy.cpu >= 1 ? busy : undefined;
  const big = topBy(services, "memKb");
  return {
    headline: machine
      ? `${coreCount(cpu)} of ${machine.cores} cores · ${formatMem(memKb)} of ${formatRam(machine.memKb)}`
      : `${formatCpu(cpu)} CPU · ${formatMem(memKb)}`,
    ...(machine && { share: `${Math.round(pct(cpu, cpuWhole))}% of this Mac's CPU, ${Math.round(pct(memKb, memWhole))}% of its memory` }),
    kinds,
    ...(busiest && { busiest: named(busiest) }),
    ...(big && big !== busiest && { biggest: named(big) }),
  };
}
