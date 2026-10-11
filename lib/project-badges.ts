// The production-ready tree: what Weft looks for in a project, branch by branch, and the prompt a
// locked check's "Set it up" button starts a card with. Pure, so the dialog can import it;
// lib/project-checks.ts does the looking on the server.

export type BranchId = "testing" | "security" | "observability" | "docs" | "delivery";

export interface CheckDef {
  id: string;
  branch: BranchId;
  label: string;
  // What counts, shown under a locked check.
  hint: string;
  // What the card it starts is asked to do.
  setup: string;
}

export const BRANCHES: { id: BranchId; label: string; icon: string }[] = [
  { id: "testing", label: "Testing", icon: "🧪" },
  { id: "security", label: "Security", icon: "🔐" },
  { id: "observability", label: "Observability", icon: "📡" },
  { id: "docs", label: "Docs", icon: "📚" },
  { id: "delivery", label: "Delivery", icon: "🚢" },
];

const c = (branch: BranchId, id: string, label: string, hint: string, setup: string): CheckDef => ({ id, branch, label, hint, setup });

export const CHECKS: CheckDef[] = [
  c("testing", "coverage", "Coverage report", "coverage/coverage-summary.json from `npm run coverage`",
    "Set up a test runner with coverage (run /weft:setup-done if there is none) so `npm run coverage` writes coverage/coverage-summary.json with the json-summary reporter."),
  c("testing", "covered80", "80% of lines covered", "line coverage of 80% or more",
    "Raise line coverage to 80%: run coverage, then add behavior tests for the least covered modules, most important first."),
  c("testing", "guarded", "Guarded", "a pre-commit hook and CI that lint, type-check and test",
    "Add guardrails: a pre-commit hook that lints and type-checks (or tests) staged work, and a CI workflow that runs lint, typecheck and tests on every push."),
  c("testing", "strict", "Strict", "strict types and a strict, warnings-fail linter",
    "Tighten types and lint: `strict` and `noUncheckedIndexedAccess` in tsconfig, a strict type-aware lint preset, and `--max-warnings 0`. Fix what's quick and leave a commented override for the rest."),
  c("testing", "slim", "Slim files", "no source file over 300 lines",
    "Split source files over 300 lines into focused modules, longest first, in small behavior-preserving steps with tests in place."),
  c("security", "envIgnored", "Secrets ignored", ".env files in .gitignore and an .env.example",
    "Make sure .env and .env.* (except .env.example) are in .gitignore, no secrets are committed, and an .env.example lists every variable with a placeholder."),
  c("security", "secretScan", "Secret scanning", "gitleaks or trufflehog in the pre-commit hook or CI",
    "Add secret scanning: gitleaks (or trufflehog) in the pre-commit hook and in CI, with an allowlist for known false positives."),
  c("security", "depBot", "Dependency updates", "Dependabot or Renovate configured",
    "Add a Dependabot config (.github/dependabot.yml) for this project's package ecosystems and GitHub Actions, weekly, grouping minor and patch updates."),
  c("security", "headers", "Security headers", "a Content-Security-Policy or helmet",
    "Add security headers: a Content-Security-Policy and the usual hardening headers (frame-ancestors, nosniff, referrer policy), set where this framework sets headers. Check the app still loads."),
  c("security", "securityMd", "SECURITY.md", "a SECURITY.md saying how to report a vulnerability",
    "Write a short SECURITY.md: supported versions, how to report a vulnerability privately, and what reporters can expect."),
  c("observability", "analytics", "Product analytics", "PostHog, Amplitude, Plausible, Segment, Mixpanel or Vercel Analytics",
    "Install product analytics (PostHog unless the project already points elsewhere): the client SDK, page views, and an env var for the key in .env.example."),
  c("observability", "errors", "Error tracking", "Sentry, Bugsnag, Rollbar, Highlight or Datadog RUM",
    "Install error tracking (Sentry unless the project already points elsewhere) for both client and server, with source maps and the DSN in .env.example."),
  c("observability", "tracing", "Tracing", "OpenTelemetry (@opentelemetry/* or @vercel/otel)",
    "Add OpenTelemetry tracing for the server (for Next.js, @vercel/otel in instrumentation.ts), exporting to an endpoint set by env var."),
  c("observability", "logs", "Structured logs", "pino, winston or bunyan",
    "Replace ad-hoc console logging on the server with a structured logger (pino), with a level set by env var."),
  c("observability", "health", "Health check", "a /health or /api/health route",
    "Add a health check route (/api/health) that returns 200 and the app version, and checks any database it depends on."),
  c("docs", "readme", "README", "a README.md",
    "Write a README.md: what this is, how to run it locally, how to test it, and how it deploys."),
  c("docs", "agentDocs", "Agent-ready", "a CLAUDE.md or AGENTS.md",
    "Write a CLAUDE.md for agents working here: what the project is, a file map, conventions, and the commands to lint, type-check and test."),
  c("docs", "architecture", "Architecture docs", "a docs/architecture folder",
    "Start docs/architecture/ with an overview doc of how this project fits together (run /architecture if available)."),
  c("docs", "docsFresh", "Docs fresh", "README changed in the last 20 commits",
    "Bring the README up to date with what the code does today: read recent commits and fix anything stale."),
  c("docs", "license", "License", "a LICENSE file",
    "Add a LICENSE file. Ask me which license I want before writing it."),
  c("delivery", "deploys", "Deploys", "Vercel, Netlify, Fly or Render config, or a deploy workflow",
    "Set up deploys for this project. Ask me which host I want, then add its config and document the deploy in the README."),
  c("delivery", "pinned", "Pinned runtime", ".nvmrc, .node-version, .tool-versions, .python-version or engines",
    "Pin the runtime version (.nvmrc and package.json engines for Node, .python-version for Python) to what the project uses today."),
  c("delivery", "lockfile", "Lockfile", "a committed lockfile",
    "Commit the package manager's lockfile, and make CI install from it (npm ci or the equivalent)."),
  c("delivery", "upstream", "Pushed", "a git remote",
    "This repo has no remote. Ask me where it should live, then add the remote and push."),
];

export type CheckState = Record<string, boolean>;

// A project's tree as measured: which checks pass, its stack, and its quality numbers.
export interface ProjectReport {
  root: string;
  name: string;
  stack: string[];
  ok: CheckState;
  // The checklist score (lib/quality.ts) and line coverage, when measured.
  score: number | null;
  coverage: number | null;
  // Every quality check passes.
  perfect: boolean;
  // Nothing uncommitted.
  clean: boolean;
}

export function branchProgress(report: ProjectReport, branch: BranchId) {
  const checks = CHECKS.filter((ch) => ch.branch === branch);
  return { done: checks.filter((ch) => report.ok[ch.id]).length, total: checks.length };
}

export function branchComplete(report: ProjectReport, branch: BranchId) {
  const p = branchProgress(report, branch);
  return p.done === p.total;
}

export function productionReady(report: ProjectReport) {
  return BRANCHES.every((b) => branchComplete(report, b.id));
}

// The first message of the card a locked check starts.
export function setupPrompt(check: CheckDef, report: Pick<ProjectReport, "name">) {
  return `${check.setup}\n\nThis is for the "${check.label}" badge in Weft's production-ready tree for ${report.name}. Keep the change small, follow the project's conventions, and verify it works.`;
}
