import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findCoverage, type CoverageReport } from "./coverage";
import { MAX_LINES, type Check, type QualityReport, type Section } from "./quality-view";

// Measures a project's code quality for the header badge: test coverage, file size, how locked down
// the linter is, type safety and commit/CI guardrails. Reads files only; never runs the project's tools.

const SOURCE = /\.(tsx?|jsx?|mjs|cjs|mts|cts|py|go|rs|rb|java|kt|swift|vue|svelte)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage", "vendor", "venv", "__pycache__", "target"]);
const GENERATED = /\.d\.ts$|\.min\.js$/;
const TEST = /[._](test|spec)\.[a-z]+$|(^|\/)(__tests__|tests?)\//;
const MAX_FILES = 5000;
const MAX_BYTES = 1_000_000;

type Source = { path: string; lines: number; text: string; test: boolean };
type Pkg = { scripts?: Record<string, string>; [key: string]: unknown };

// The project a folder belongs to: its git root, else the folder itself.
export function projectRoot(cwd: string): string {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(cwd);
    dir = parent;
  }
}

function skipped(rel: string) {
  return rel.split("/").slice(0, -1).some((d) => SKIP_DIRS.has(d) || d.startsWith("."));
}

// Without git: every file under root, skipping dependency, build and dot folders.
function walk(root: string, rel = "", out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (out.length >= MAX_FILES) break;
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(root, p, out);
    } else out.push(p);
  }
  return out;
}

// Source files, relative to root: git's tracked and untracked-but-not-ignored files, else a walk.
export function listSources(root: string): string[] {
  let files: string[];
  try {
    files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    }).split("\n");
  } catch {
    files = walk(root);
  }
  return files.filter((f) => SOURCE.test(f) && !GENERATED.test(f) && !skipped(f)).slice(0, MAX_FILES);
}

function readSources(root: string): Source[] {
  const out: Source[] = [];
  for (const rel of listSources(root)) {
    try {
      const file = path.join(root, rel);
      if (fs.statSync(file).size > MAX_BYTES) continue;
      const text = fs.readFileSync(file, "utf8");
      const lines = text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0;
      out.push({ path: rel, lines, text, test: TEST.test(rel) });
    } catch {
      // Listed by git but deleted from the tree.
    }
  }
  return out;
}

function read(root: string, rel: string): string {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch {
    return "";
  }
}

function score(checks: Check[]) {
  return Math.round((100 * checks.filter((c) => c.ok).length) / checks.length);
}

function testsSection(cov: CoverageReport | null): Section {
  const checks = [
    { label: "a coverage report at coverage/coverage-summary.json", ok: !!cov },
    { label: "80%+ of lines covered", ok: !!cov && cov.lines >= 80 },
  ];
  return {
    key: "tests",
    name: "Tests",
    score: cov ? Math.round(cov.lines) : 0,
    summary: cov
      ? `${Math.round(cov.lines)}% of lines covered, ${Math.round(cov.branches)}% of branches`
      : "no coverage report",
    checks,
  };
}

// Scores the share of code that sits within MAX_LINES of the top of its file, so one 1,200-line
// file costs more than a few that run a little long. Test files are listed but don't count.
function sizeSection(sources: Source[]): Section {
  const code = sources.filter((s) => !s.test);
  const total = code.reduce((n, s) => n + s.lines, 0);
  const within = code.reduce((n, s) => n + Math.min(s.lines, MAX_LINES), 0);
  const long = code.filter((s) => s.lines > MAX_LINES).sort((a, b) => b.lines - a.lines);
  const longTests = sources.filter((s) => s.test && s.lines > MAX_LINES).length;
  return {
    key: "size",
    name: "File size",
    score: total ? Math.round((100 * within) / total) : null,
    summary:
      `${long.length} of ${code.length} files over ${MAX_LINES} lines` +
      (longTests ? `, plus ${longTests} test file${longTests === 1 ? "" : "s"}` : ""),
    checks: [],
    longFiles: long.slice(0, 5).map((s) => ({ path: s.path, lines: s.lines })),
  };
}

const ESLINT = ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts", "eslint.config.mts"]
  .concat([".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yml", ".eslintrc.yaml"])
  .concat(["biome.json", "biome.jsonc"]);

function lintSection(root: string, pkg: Pkg): Section {
  const pyproject = read(root, "pyproject.toml");
  const ruff = read(root, "ruff.toml") + read(root, ".ruff.toml") + (pyproject.includes("[tool.ruff") ? pyproject : "");
  const js = ESLINT.map((f) => read(root, f)).join("\n") + (pkg.eslintConfig ? JSON.stringify(pkg.eslintConfig) : "");
  const config = js.trim() + ruff;
  const script = pkg.scripts?.lint ?? "";
  const off = (js.match(/["']off["']|:\s*0\b/g) ?? []).length;
  const checks = [
    { label: "a linter config (ESLint, Biome or Ruff)", ok: !!config },
    { label: "a strict or type-aware preset", ok: /strict|typechecked|type-checked|"ALL"/i.test(config) },
    // Ruff has no warnings: every rule it selects fails the run.
    { label: "warnings fail the lint (--max-warnings 0)", ok: /--max-warnings[= ]0\b|--error-on-warnings/.test(script) || (!js.trim() && !!ruff) },
    { label: `a max-lines rule (${MAX_LINES})`, ok: /max-lines["'\s:]|noExcessiveLinesPerFile/.test(config) },
    { label: "a complexity rule", ok: /complexity|max-depth|max-lines-per-function|C90|mccabe/i.test(config) },
    { label: "two or fewer rules switched off", ok: !!config && off <= 2 },
  ];
  const passed = checks.filter((c) => c.ok).length;
  return {
    key: "lint",
    name: "Lint lockdown",
    score: score(checks),
    summary: config ? `${passed} of ${checks.length} lockdown checks pass` : "no linter config",
    checks,
  };
}

const TS = /\.(tsx?|mts|cts)$/;
// Built from pieces so this file doesn't count its own patterns.
const TS_HATCH = new RegExp(["\\bas\\s+any\\b", ":\\s*any\\b", "<any>", "@ts-(?:ignore|nocheck)", "eslint-(?:disable)"].join("|"), "g");
const PY_HATCH = new RegExp(["#\\s*type:\\s*(?:ignore)", "#\\s*(?:noqa)"].join("|"), "g");

function typesSection(root: string, sources: Source[]): Section {
  const code = sources.filter((s) => !s.test);
  const tsconfig = read(root, "tsconfig.json");
  const ts = !!tsconfig || code.some((s) => TS.test(s.path));
  const py = code.some((s) => s.path.endsWith(".py"));
  if (!ts && !py) return { key: "types", name: "Type safety", score: null, summary: "no TypeScript or Python", checks: [] };
  const lines = code.reduce((n, s) => n + s.lines, 0);
  const hatch = ts ? TS_HATCH : PY_HATCH;
  const hatches = code
    .filter((s) => (ts ? /\.(tsx?|jsx?|mts|cts|mjs|cjs)$/ : /\.py$/).test(s.path))
    .reduce((n, s) => n + (s.text.match(hatch) ?? []).length, 0);
  const budget = Math.max(1, Math.floor(lines / 1000));
  const pyTypes = read(root, "mypy.ini") + read(root, "pyrightconfig.json") + (/\[tool\.(mypy|pyright)/.test(read(root, "pyproject.toml")) ? read(root, "pyproject.toml") : "");
  const checks = ts
    ? [
        { label: "tsconfig strict", ok: /"strict"\s*:\s*true/.test(tsconfig) },
        { label: "tsconfig noUncheckedIndexedAccess", ok: /"noUncheckedIndexedAccess"\s*:\s*true/.test(tsconfig) },
        { label: `at most ${budget} escape hatch${budget === 1 ? "" : "es"} (1 per 1,000 lines)`, ok: hatches <= budget },
      ]
    : [
        { label: "a type checker config (mypy or pyright)", ok: !!pyTypes },
        { label: "strict type checking", ok: /strict\s*=\s*true|typeCheckingMode"?\s*[:=]\s*"strict"/.test(pyTypes) },
        { label: `at most ${budget} escape hatch${budget === 1 ? "" : "es"} (1 per 1,000 lines)`, ok: hatches <= budget },
      ];
  return {
    key: "types",
    name: "Type safety",
    score: score(checks),
    summary: `${checks[1]?.ok ? "strict" : checks[0]?.ok ? "partly strict" : "not strict"}, ${hatches} escape hatch${hatches === 1 ? "" : "es"} (any, ignores, lint disables)`,
    checks,
  };
}

const HOOKS = [".githooks/pre-commit", ".husky/pre-commit", ".git/hooks/pre-commit", "lefthook.yml", "lefthook.yaml", ".pre-commit-config.yaml"];

// A hook or CI file plus the repo scripts and package scripts it calls, one level deep.
function expand(root: string, text: string, pkg: Pkg): string {
  const scripts = [...text.matchAll(/(?:^|[\s/"'])(scripts\/[\w./-]+)/g)].map((m) => read(root, m[1] ?? ""));
  const npm = [...text.matchAll(/\b(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+([\w:-]+)/g)].map((m) => pkg.scripts?.[m[1] ?? ""] ?? "");
  return [text, ...scripts, ...npm].join("\n");
}

function ciFiles(root: string): string {
  let workflows: string[] = [];
  try {
    workflows = fs.readdirSync(path.join(root, ".github", "workflows")).filter((f) => /\.ya?ml$/.test(f));
  } catch {
    // No GitHub Actions.
  }
  return [...workflows.map((f) => `.github/workflows/${f}`), ".gitlab-ci.yml", ".circleci/config.yml"]
    .map((f) => read(root, f))
    .join("\n")
    .trim();
}

const LINTS = /lint|eslint|biome|ruff/i;
const TESTS = /\btest\b|vitest|jest|pytest|coverage/i;
const TYPES = /\btsc\b|typecheck|type-check|mypy|pyright/i;

function guardsSection(root: string, pkg: Pkg): Section {
  const hookRaw = HOOKS.map((f) => read(root, f)).join("\n").trim() + (pkg["lint-staged"] ? "lint-staged" : "");
  const hook = hookRaw ? expand(root, hookRaw, pkg) : "";
  const ciRaw = ciFiles(root);
  const ci = ciRaw ? expand(root, ciRaw, pkg) : "";
  const checks = [
    { label: "a pre-commit hook", ok: !!hook },
    { label: "the hook lints", ok: LINTS.test(hook) },
    { label: "the hook type-checks or tests", ok: TYPES.test(hook) || TESTS.test(hook) },
    { label: "a CI workflow", ok: !!ci },
    { label: "CI lints", ok: LINTS.test(ci) },
    { label: "CI runs tests", ok: TESTS.test(ci) },
    { label: "CI type-checks", ok: TYPES.test(ci) },
  ];
  return {
    key: "guards",
    name: "Guardrails",
    score: score(checks),
    summary: `${hook ? "pre-commit hook" : "no pre-commit hook"}, ${ci ? "CI" : "no CI"}`,
    checks,
  };
}

// The whole report for the project a folder belongs to.
export function measureQuality(cwd: string): QualityReport {
  const root = projectRoot(cwd);
  let pkg: Pkg = {};
  try {
    pkg = JSON.parse(read(root, "package.json") || "{}") as Pkg;
  } catch {
    // A broken package.json reads as none.
  }
  const sources = readSources(root);
  const cov = findCoverage(cwd);
  const sections = [testsSection(cov), sizeSection(sources), lintSection(root, pkg), typesSection(root, sources), guardsSection(root, pkg)];
  const scored = sections.flatMap((s) => (s.score === null ? [] : [s.score]));
  return {
    root,
    score: scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : 0,
    sections,
    coverageAt: cov?.measuredAt ?? null,
  };
}
