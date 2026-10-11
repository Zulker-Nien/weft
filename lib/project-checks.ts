import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readPile } from "./commit-pile";
import { findCoverage } from "./coverage";
import type { CheckState, ProjectReport } from "./project-badges";
import { measureQuality } from "./quality";

// Measures a project for the production-ready tree (lib/project-badges.ts) and the stack skills:
// file and package.json lookups plus the quality checklist. Reads only; never runs the project's tools.

type Pkg = { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; engines?: unknown };

// Tech a dependency (or a file) means, for the stack skills. First match per tech wins.
const STACK: [string, RegExp][] = [
  ["Next.js", /^next$/],
  ["React", /^react$/],
  ["React Native", /^(react-native|expo)$/],
  ["Electron", /^electron$/],
  ["Vue", /^(vue|nuxt)$/],
  ["Svelte", /^(svelte|@sveltejs\/kit)$/],
  ["Tailwind", /^tailwindcss$/],
  ["Supabase", /^@supabase\//],
  ["Prisma", /^(prisma|@prisma\/client)$/],
  ["Drizzle", /^drizzle-orm$/],
  ["Stripe", /^(stripe|@stripe\/)/],
  ["Claude", /^@anthropic-ai\//],
  ["OpenAI", /^openai$/],
  ["Three.js", /^(three|@react-three\/)/],
  ["Vitest", /^vitest$/],
  ["Playwright", /^@playwright\//],
];

const FILE_STACK: [string, string[]][] = [
  ["Python", ["pyproject.toml", "requirements.txt"]],
  ["Go", ["go.mod"]],
  ["Rust", ["Cargo.toml"]],
  ["Swift", ["Package.swift"]],
];

function read(root: string, file: string): string {
  try {
    return fs.readFileSync(path.join(root, file), "utf8");
  } catch {
    return "";
  }
}

const has = (root: string, ...files: string[]) => files.some((f) => fs.existsSync(path.join(root, f)));

function git(root: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function readPkg(root: string): Pkg {
  try {
    return JSON.parse(read(root, "package.json") || "{}") as Pkg;
  } catch {
    return {};
  }
}

function deps(pkg: Pkg): string[] {
  return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
}

export function detectStack(root: string): string[] {
  const names = deps(readPkg(root));
  const found = STACK.filter(([, re]) => names.some((n) => re.test(n))).map(([tech]) => tech);
  return [...found, ...FILE_STACK.filter(([, files]) => has(root, ...files)).map(([tech]) => tech)];
}

// Everything git knows of (tracked or untracked but not ignored), else nothing.
function files(root: string): string[] {
  return git(root, ["ls-files", "-co", "--exclude-standard"]).split("\n").filter(Boolean);
}

// Text of the hooks and CI workflows, where scanners and deploy steps live.
function pipelineText(root: string, list: string[]): string {
  return list
    .filter((f) => /^(\.githooks|\.husky|\.github\/workflows)\/|^\.pre-commit-config\.ya?ml$|^\.gitlab-ci\.yml$/.test(f))
    .slice(0, 50)
    .map((f) => read(root, f))
    .join("\n");
}

function securityChecks(root: string, list: string[], names: string[], pipeline: string): CheckState {
  const gitignore = read(root, ".gitignore");
  const config = ["next.config.ts", "next.config.js", "next.config.mjs", "middleware.ts", "src/middleware.ts", "vercel.json"].map((f) => read(root, f)).join("\n");
  return {
    envIgnored: /^\/?\.env/m.test(gitignore) && has(root, ".env.example", ".env.sample", ".env.template"),
    secretScan: /gitleaks|trufflehog/i.test(pipeline),
    depBot: has(root, ".github/dependabot.yml", ".github/dependabot.yaml", "renovate.json", "renovate.json5", ".github/renovate.json", ".renovaterc"),
    headers: /Content-Security-Policy/i.test(config) || names.includes("helmet") || list.some((f) => /(^|\/)_headers$/.test(f)),
    securityMd: has(root, "SECURITY.md", ".github/SECURITY.md"),
  };
}

const ANALYTICS = /^(posthog-js|posthog-node|@amplitude\/|amplitude-js|plausible-tracker|next-plausible|@segment\/|mixpanel|@vercel\/analytics)/;
const ERRORS = /^(@sentry\/|@bugsnag\/|rollbar|@highlight-run\/|@datadog\/browser-rum)/;

function observabilityChecks(list: string[], names: string[]): CheckState {
  return {
    analytics: names.some((n) => ANALYTICS.test(n)),
    errors: names.some((n) => ERRORS.test(n)),
    tracing: names.some((n) => /^(@opentelemetry\/|@vercel\/otel$)/.test(n)),
    logs: names.some((n) => /^(pino|winston|bunyan)$/.test(n)),
    health: list.some((f) => /(^|\/)(api\/)?health[z]?(\/route|\/index)?\.[a-z]+$/.test(f) || /(^|\/)(api\/)?health[z]?\/route\./.test(f)),
  };
}

function docsChecks(root: string, list: string[]): CheckState {
  const recent = git(root, ["log", "-20", "--name-only", "--format="]);
  return {
    readme: has(root, "README.md", "readme.md", "README"),
    agentDocs: has(root, "CLAUDE.md", "AGENTS.md"),
    architecture: list.some((f) => f.startsWith("docs/architecture/")),
    docsFresh: /^README\.md$/im.test(recent),
    license: list.some((f) => /^(LICENSE|LICENCE|COPYING)(\.|$)/i.test(f)),
  };
}

function deliveryChecks(root: string, list: string[], pkg: Pkg, pipeline: string): CheckState {
  return {
    deploys:
      has(root, "vercel.json", ".vercel/project.json", "netlify.toml", "fly.toml", "render.yaml", "app.yaml", "railway.json") ||
      /\bdeploy\b/i.test(pipeline),
    pinned: has(root, ".nvmrc", ".node-version", ".tool-versions", ".python-version") || !!pkg.engines,
    lockfile: list.some((f) => /^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|uv\.lock|poetry\.lock|Cargo\.lock|go\.sum)$/.test(f)),
    upstream: git(root, ["remote"]).trim().length > 0,
  };
}

function testingChecks(root: string) {
  const q = measureQuality(root);
  const score = (key: string) => q.sections.find((s) => s.key === key)?.score;
  const cov = findCoverage(root);
  return {
    quality: q,
    coverage: cov ? cov.lines : null,
    ok: {
      coverage: !!cov,
      covered80: !!cov && cov.lines >= 80,
      guarded: score("guards") === 100,
      // No TypeScript or Python to type-check (null) doesn't hold it back.
      strict: (score("types") ?? 100) === 100 && (score("lint") ?? 0) >= 80,
      slim: score("size") === 100,
    },
  };
}

// The whole report for one project root.
export function checkProject(root: string): ProjectReport {
  const pkg = readPkg(root);
  const names = deps(pkg);
  const list = files(root);
  const pipeline = pipelineText(root, list);
  const testing = testingChecks(root);
  return {
    root,
    name: path.basename(root),
    stack: detectStack(root),
    ok: {
      ...testing.ok,
      ...securityChecks(root, list, names, pipeline),
      ...observabilityChecks(list, names),
      ...docsChecks(root, list),
      ...deliveryChecks(root, list, pkg, pipeline),
    },
    score: testing.quality.score,
    coverage: testing.coverage,
    perfect: testing.quality.sections.every((s) => s.score === null || s.score === 100),
    clean: !!git(root, ["rev-parse", "--git-dir"]) && readPile(root) === null,
  };
}
