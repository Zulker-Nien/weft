import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECKS } from "./project-badges";
import type { Section } from "./quality-view";

const sections = (score: number | null): Section[] =>
  (["tests", "size", "lint", "types", "guards"] as const).map((key) => ({ key, name: key, score, summary: "", checks: [] }));

const quality = { score: 100, sections: sections(100) };
const coverage = { value: { lines: 90 } as { lines: number } | null };
const pile = { value: null as object | null };

vi.mock("./quality", () => ({ measureQuality: vi.fn(() => ({ root: "/", coverageAt: null, ...quality })) }));
vi.mock("./coverage", () => ({ findCoverage: vi.fn(() => coverage.value) }));
vi.mock("./commit-pile", () => ({ readPile: vi.fn(() => pile.value) }));

const { checkProject, detectStack } = await import("./project-checks");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-checks-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function write(root: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
}

const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: root, stdio: "ignore" });

beforeEach(() => {
  quality.score = 100;
  quality.sections = sections(100);
  pile.value = null;
  coverage.value = { lines: 90 };
});

describe("checkProject", () => {
  it("finds every check in a fully set-up repo", () => {
    const root = path.join(tmp, "full");
    fs.mkdirSync(root);
    write(root, {
      "package.json": JSON.stringify({
        dependencies: { next: "1", "@supabase/supabase-js": "1", "posthog-js": "1", "@sentry/nextjs": "1", "@vercel/otel": "1", pino: "1", helmet: "1" },
        engines: { node: ">=22" },
      }),
      "package-lock.json": "{}",
      "pyproject.toml": "",
      "README.md": "# app",
      "CLAUDE.md": "",
      "docs/architecture/overview.md": "",
      LICENSE: "MIT",
      ".gitignore": ".env*\n!.env.example\n",
      ".env.example": "KEY=",
      ".github/dependabot.yml": "",
      "SECURITY.md": "",
      "app/api/health/route.ts": "",
      ".githooks/pre-commit": "npx gitleaks protect",
      ".github/workflows/ci.yml": "jobs: deploy",
    });
    git(root, "init", "-q");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "init");
    git(root, "remote", "add", "origin", "https://example.com/app.git");
    const report = checkProject(root);
    expect(CHECKS.filter((c) => !report.ok[c.id]).map((c) => c.id)).toEqual([]);
    expect(report).toMatchObject({ name: "full", score: 100, coverage: 90, perfect: true, clean: true });
    expect(report.stack).toEqual(["Next.js", "Supabase", "Python"]);
  });

  it("finds nothing in a bare folder, and reads a broken package.json as none", () => {
    const root = path.join(tmp, "bare");
    write(root, { "package.json": "{ broken" });
    quality.score = 40;
    quality.sections = sections(null);
    coverage.value = null;
    const report = checkProject(root);
    expect(Object.entries(report.ok).filter(([, ok]) => ok)).toEqual([]);
    expect(report).toMatchObject({ stack: [], clean: false, perfect: true, coverage: null });
  });

  it("scores coverage, strictness and a dirty tree from the quality checklist", () => {
    const root = path.join(tmp, "dirty");
    fs.mkdirSync(root);
    git(root, "init", "-q");
    pile.value = { files: ["a"] };
    quality.sections = sections(60);
    const report = checkProject(root);
    expect(report.ok).toMatchObject({ coverage: true, covered80: true, guarded: false, strict: false, slim: false });
    expect(report.clean).toBe(false);
    expect(report.perfect).toBe(false);
  });
});

describe("detectStack", () => {
  it("reads dependencies and marker files", () => {
    const root = path.join(tmp, "stack");
    write(root, { "package.json": JSON.stringify({ devDependencies: { electron: "1", vitest: "1" } }), "go.mod": "" });
    expect(detectStack(root)).toEqual(["Electron", "Vitest", "Go"]);
    expect(detectStack(path.join(tmp, "missing"))).toEqual([]);
  });
});
