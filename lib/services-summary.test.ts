import { describe, expect, it } from "vitest";
import { formatCores, formatRam, KIND_LABELS, KIND_TONE, summarize } from "./services-summary";
import type { ServiceEntry } from "./types";

const entry = (over: Partial<ServiceEntry> = {}): ServiceEntry => ({
  id: "weft",
  kind: "weft",
  label: "Weft",
  state: "running",
  cpu: 0,
  memKb: 0,
  startedAt: 0,
  procs: [],
  ...over,
});

const GB = 1024 * 1024;
const MAC = { cores: 10, memKb: 16 * GB };

describe("formatCores", () => {
  it("reads ps's percent as cores", () => {
    expect(formatCores(276)).toBe("2.8 cores");
    expect(formatCores(100)).toBe("1.0 core");
    expect(formatCores(4)).toBe("0.0 cores");
    expect(formatCores(1240)).toBe("12 cores");
  });
});

describe("formatRam", () => {
  it("rounds to whole GB", () => {
    expect(formatRam(16 * GB + 1234)).toBe("16 GB");
  });
});

describe("summarize", () => {
  const list = [
    entry({ cpu: 60, memKb: 1.6 * GB }),
    entry({ id: "cli:a", kind: "cli", label: "Claude Code", title: "Fix login", cpu: 150, memKb: 1 * GB }),
    entry({ id: "cli:b", kind: "cli", label: "Codex", cpu: 40, memKb: 4 * GB }),
    entry({ id: "dev:c", kind: "dev", label: "pnpm dev", cpu: 26, memKb: 0.5 * GB }),
    entry({ id: "dev:d", kind: "dev", label: "stopped", state: "stopped" }),
  ];

  it("puts the total against this Mac", () => {
    const s = summarize(list, MAC);
    expect(s.headline).toBe("2.8 of 10 cores · 7.1 GB of 16 GB");
    expect(s.share).toBe("28% of this Mac's CPU, 44% of its memory");
  });

  it("falls back to the bare total before the Mac is known", () => {
    const s = summarize(list);
    expect(s.headline).toBe("276% CPU · 7.1 GB");
    expect(s.share).toBeUndefined();
    // Without a whole to measure against, the bars split the total.
    expect(s.kinds.reduce((n, k) => n + k.cpuPct, 0)).toBeCloseTo(100);
  });

  it("splits by kind, busiest first, and skips what uses nothing", () => {
    const { kinds } = summarize(list, MAC);
    expect(kinds.map((k) => [k.label, k.count, k.usage])).toEqual([
      ["Threads", 2, "1.9 cores · 5.0 GB"],
      ["Weft", 1, "0.6 cores · 1.6 GB"],
      ["Dev servers", 1, "0.3 cores · 512 MB"],
    ]);
    expect(kinds[0]?.cpuPct).toBeCloseTo(19);
    expect(kinds[0]?.memPct).toBeCloseTo(31.25);
  });

  it("orders equal CPU by memory and caps a bar at the whole", () => {
    const { kinds } = summarize([entry({ kind: "terminal", memKb: 1 }), entry({ kind: "other", memKb: 2 })], { cores: 1, memKb: 1 });
    expect(kinds.map((k) => k.kind)).toEqual(["other", "terminal"]);
    expect(kinds[0]?.memPct).toBe(100);
  });

  it("names the busiest and, when it's another, the biggest", () => {
    const s = summarize(list, MAC);
    expect(s.busiest).toEqual({ label: "Claude Code · Fix login", usage: "150% · 1.0 GB" });
    expect(s.biggest).toEqual({ label: "Codex", usage: "40% · 4.0 GB" });
    expect(summarize([list[1] as ServiceEntry], MAC).biggest).toBeUndefined();
  });

  it("names no busiest when nothing is busy", () => {
    const s = summarize([entry({ cpu: 0.4, memKb: 10 })], MAC);
    expect(s.busiest).toBeUndefined();
    expect(s.biggest?.label).toBe("Weft");
    expect(summarize([], MAC)).toMatchObject({ kinds: [], headline: "0.0 of 10 cores · 0 KB of 16 GB" });
    expect(summarize([], { cores: 0, memKb: 0 }).share).toBe("0% of this Mac's CPU, 0% of its memory");
  });

  it("has a label and a tone for every kind", () => {
    expect(Object.keys(KIND_LABELS).sort()).toEqual(Object.keys(KIND_TONE).sort());
  });
});
