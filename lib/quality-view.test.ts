import { describe, expect, it } from "vitest";
import { fixPrompt, tone, weakest, type QualityReport, type Section } from "./quality-view";

const section = (key: Section["key"], score: number | null, extra: Partial<Section> = {}): Section => ({
  key,
  name: key,
  score,
  summary: `${key} summary`,
  checks: [],
  ...extra,
});

const report = (sections: Section[], score = 70): QualityReport => ({ root: "/p", score, sections, coverageAt: null });

describe("tone", () => {
  it("is green from 80, amber from 50, red below", () => {
    expect([tone(80), tone(50), tone(49)]).toEqual(["text-ok", "text-warn", "text-danger"]);
  });
});

describe("weakest", () => {
  it("lists the sections under 100 that apply, worst first", () => {
    const r = report([section("tests", 90), section("types", null), section("lint", 100), section("docs", 40)]);
    expect(weakest(r).map((s) => s.key)).toEqual(["docs", "tests"]);
  });
});

describe("fixPrompt", () => {
  it("asks for what the score misses when nothing is weak", () => {
    expect(fixPrompt(report([section("tests", 100)], 100))).toContain("at 100%");
  });

  it("lists weak sections with their failing checks, long files and how to fix them", () => {
    const prompt = fixPrompt(
      report([
        section("docs", 50, { checks: [{ label: "a CHANGELOG", ok: false }, { label: "a README", ok: true }] }),
        section("size", 80, { longFiles: [{ path: "a.ts", lines: 900 }] }),
      ]),
    );
    expect(prompt).toContain("1. docs, 50%: docs summary. Missing: a CHANGELOG.\n");
    expect(prompt).toContain("2. size, 80%: size summary. Longest: a.ts (900).");
    expect(prompt).toContain("CLAUDE.md or AGENTS.md");
    expect(prompt).toContain("Don't use `git stash`");
  });
});
