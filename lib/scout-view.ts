// The refactor scout's findings, the score they fold into, and the card each one starts. Pure, so the
// client can import it; lib/scout.ts runs the scout on the server.

export const CATEGORIES = ["refactor", "lint", "types", "tests", "guardrails"] as const;
export type ScoutCategory = (typeof CATEGORIES)[number];

export const SEVERITIES = ["high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export type Finding = {
  // file:line:smell, so a re-run keeps a finding's id while it's still open.
  id: string;
  file: string;
  line: number;
  // Named Fowler-style: Long Function, Duplicated Code, Feature Envy, Primitive Obsession…
  smell: string;
  category: ScoutCategory;
  severity: Severity;
  fix: string;
};

export type ScoutReport = {
  root: string;
  // HEAD when it ran; null outside git.
  commit: string | null;
  ranAt: number;
  findings: Finding[];
  // Ids handed to a card, so the menu doesn't offer them twice.
  started: string[];
};

// What the badge reads: the last report, and whether a fresh one is on its way.
export type ScoutState = { report: ScoutReport | null; running: boolean; error?: string };

export const WEIGHT: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

// The checklist earns 90 points; the scout's band earns the last 10, shrinking as open findings pile up.
export const CHECKLIST_SHARE = 0.9;
export const BAND = 10;
// Debt at which the band is half gone.
export const HALF = 10;
// There's always another refactor.
export const CEILING = 99;

export function debt(findings: Finding[]) {
  return findings.reduce((n, f) => n + WEIGHT[f.severity], 0);
}

// What the scout band earns: 0 before the first run, then BAND × HALF ÷ (HALF + debt).
export function bandScore(report: ScoutReport | null) {
  return report ? (BAND * HALF) / (HALF + debt(report.findings)) : 0;
}

// The badge's number: the checklist scaled to 90, plus the band, never above 99.
export function headroomScore(checklist: number, report: ScoutReport | null) {
  return Math.min(CEILING, Math.round(CHECKLIST_SHARE * checklist + bandScore(report)));
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined => list.find((x) => x === v);

function toFinding(raw: unknown): Finding | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const file = clean(r.file, 300).replace(/^\.\//, "");
  const smell = clean(r.smell, 60);
  const fix = clean(r.fix, 300);
  const category = oneOf(CATEGORIES, r.category);
  if (!file || !smell || !fix || !category) return null;
  const line = typeof r.line === "number" && r.line > 0 ? Math.floor(r.line) : 1;
  const severity = oneOf(SEVERITIES, r.severity) ?? "medium";
  return { id: `${file}:${String(line)}:${smell}`, file, line, smell, category, severity, fix };
}

export const MAX_FINDINGS = 15;

// The findings in the scout's reply: the last JSON array in it, fenced or not. Bad entries are dropped.
export function parseFindings(text: string): Finding[] {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => String(m[1]));
  const bare = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  for (const candidate of [...fenced.reverse(), bare]) {
    try {
      const list: unknown = JSON.parse(candidate);
      if (!Array.isArray(list)) continue;
      const seen = new Set<string>();
      return list
        .map(toFinding)
        .filter((f): f is Finding => !!f && !seen.has(f.id) && !!seen.add(f.id))
        .slice(0, MAX_FINDINGS);
    } catch {
      // Not JSON; try the next candidate.
    }
  }
  return [];
}

// Open findings, worst first; ties keep the scout's own ranking.
export function openFindings(report: ScoutReport | null): Finding[] {
  if (!report) return [];
  const rank = (f: Finding) => SEVERITIES.indexOf(f.severity);
  return report.findings.filter((f) => !report.started.includes(f.id)).sort((a, b) => rank(a) - rank(b));
}

export function findingTitle(f: Finding) {
  return `${f.smell}: ${f.file.slice(f.file.lastIndexOf("/") + 1)}`;
}

// The self-contained prompt for the small card one finding starts.
export function findingPrompt(f: Finding) {
  return (
    `Weft's refactor scout found this in the project (${f.category}, ${f.severity} severity):\n\n` +
    `${f.file}:${String(f.line)}: ${f.smell}\nSuggested fix: ${f.fix}\n\n` +
    "Check it's still there, then fix it in small behavior-preserving steps (Fowler, Refactoring 2nd ed.): tests in place " +
    "before you move code, and the project's lint, typecheck and tests after each step. Keep it to this one finding; " +
    "if you spot others, list them in your reply. Don't use `git stash`: other threads may have unstaged work in this folder."
  );
}

// How the number splits, for the badge's hover bubble: points from the checklist (of 90) and the scout (of 10).
export function scoreParts(checklist: number, report: ScoutReport | null) {
  return { checklist: Math.round(CHECKLIST_SHARE * checklist), scout: Math.round(bandScore(report)) };
}

// One plain sentence under the split.
export function scoreNote(report: ScoutReport | null) {
  if (!report) return "The refactor scout hasn't run yet, so the score stops at 90.";
  return "Each open finding costs a few of the scout's points. Fix one and the score goes up; it never reaches 100.";
}
