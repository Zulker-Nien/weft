// What the header's code quality badge shows, and the prompt its click sends. Pure, so the client
// can import it; lib/quality.ts measures a project on the server.

export type QualityKey = "tests" | "size" | "lint" | "types" | "guards" | "docs";

export type Check = { label: string; ok: boolean };

export type LongFile = { path: string; lines: number };

export type Section = {
  key: QualityKey;
  name: string;
  // 0–100, or null when it doesn't apply (no TypeScript or Python to type-check).
  score: number | null;
  summary: string;
  checks: Check[];
  longFiles?: LongFile[];
};

export type QualityReport = {
  root: string;
  // The average of the sections that apply, rounded.
  score: number;
  sections: Section[];
  // When the coverage report was written, if there is one.
  coverageAt: number | null;
};

// Files longer than this count against the file size score.
export const MAX_LINES = 300;

export function tone(pct: number) {
  return pct >= 80 ? "text-ok" : pct >= 50 ? "text-warn" : "text-danger";
}

// The sections that apply, weakest first.
export function weakest(report: QualityReport): Section[] {
  return report.sections
    .filter((s): s is Section & { score: number } => s.score !== null && s.score < 100)
    .sort((a, b) => a.score - b.score);
}

const HOW: Record<QualityKey, string> = {
  tests:
    "Run /weft:setup-done if there is no test runner, make sure `npm run coverage` writes coverage/coverage-summary.json " +
    "(json-summary reporter), then add tests for the least covered modules.",
  size:
    `Split files over ${MAX_LINES} lines into focused modules, longest first, in small behavior-preserving steps ` +
    "(Fowler's Extract Function / Move Function), with tests in place before each move.",
  lint:
    "Lock the linter down: a strict, type-aware preset (e.g. typescript-eslint strictTypeChecked), `--max-warnings 0` " +
    `in the lint script, \`max-lines\` (${MAX_LINES}) and \`complexity\` rules. Where a new rule floods existing files, ` +
    "fix what's quick and set a per-file override for the rest, with a comment naming the follow-up.",
  types:
    "Tighten types: `strict` and `noUncheckedIndexedAccess` in tsconfig, and remove `any`, `@ts-ignore` and " +
    "`eslint-disable` escape hatches by giving the code real types.",
  guards:
    "Add guardrails: a pre-commit hook that lints and type-checks (or tests) staged work, and a CI workflow that runs " +
    "lint, typecheck and tests on every push.",
  docs:
    "Document the project: a README for people, CLAUDE.md or AGENTS.md for agents (what the project values and a file " +
    "map), docs/architecture/*.md for each subsystem, and a CHANGELOG. Open each source file with a comment saying " +
    "what it's for, and fix or drop file paths the docs name that no longer exist.",
};

// The thread the badge starts: what's weak, worst first, and how to fix each.
export function fixPrompt(report: QualityReport): string {
  const weak = weakest(report);
  if (weak.length === 0) return "Weft scores this project's code quality at 100%. Look for anything the score misses and report it.";
  const items = weak.map((s, i) => {
    const failing = s.checks.filter((c) => !c.ok).map((c) => c.label);
    const files = s.longFiles?.length ? ` Longest: ${s.longFiles.map((f) => `${f.path} (${f.lines})`).join(", ")}.` : "";
    const missing = failing.length ? ` Missing: ${failing.join("; ")}.` : "";
    return `${i + 1}. ${s.name}, ${s.score}%: ${s.summary}.${missing}${files}\n   ${HOW[s.key]}`;
  });
  return (
    `Weft's header scores this project's code quality at ${report.score}%. Improve it, weakest area first:\n\n` +
    `${items.join("\n\n")}\n\n` +
    "Plan first and show the plan; then work in small steps, running the project's lint, typecheck and tests after each. " +
    "Don't use `git stash`: other threads may have unstaged work in this folder."
  );
}
