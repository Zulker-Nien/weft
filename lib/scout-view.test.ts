import { describe, expect, it } from "vitest";
import {
  MAX_FINDINGS,
  bandScore,
  debt,
  findingPrompt,
  findingTitle,
  headroomScore,
  openFindings,
  parseFindings,
  scoreNote,
  scoreParts,
  type Finding,
  type ScoutReport,
} from "./scout-view";

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: "lib/a.ts:10:Long Function",
  file: "lib/a.ts",
  line: 10,
  smell: "Long Function",
  category: "refactor",
  severity: "medium",
  fix: "Extract the loop",
  ...over,
});

const report = (findings: Finding[], started: string[] = []): ScoutReport => ({
  root: "/p",
  commit: "abc",
  ranAt: 1,
  findings,
  started,
});

describe("parseFindings", () => {
  const raw = { file: "./lib/a.ts", line: 10, smell: "Long Function", category: "refactor", severity: "high", fix: "Extract  the\nloop" };

  it("reads a fenced JSON array, cleaning paths and whitespace and giving each an id", () => {
    const text = `Here you go:\n\`\`\`json\n${JSON.stringify([raw])}\n\`\`\``;
    expect(parseFindings(text)).toEqual([finding({ severity: "high", fix: "Extract the loop" })]);
  });

  it("reads a bare array in prose, and prefers the last fenced block", () => {
    expect(parseFindings(`Findings: ${JSON.stringify([raw])} done`)).toHaveLength(1);
    const two = `\`\`\`\n[]\n\`\`\`\n\`\`\`json\n${JSON.stringify([raw])}\n\`\`\``;
    expect(parseFindings(two)).toHaveLength(1);
  });

  it("drops entries missing a file, smell, fix or known category, and duplicates", () => {
    const list = [raw, raw, { ...raw, file: "" }, { ...raw, smell: 3 }, { ...raw, fix: "" }, { ...raw, category: "vibes" }, null, "x"];
    expect(parseFindings(JSON.stringify(list))).toHaveLength(1);
  });

  it("defaults a bad line to 1 and an unknown severity to medium", () => {
    const [f] = parseFindings(JSON.stringify([{ ...raw, line: -4, severity: "urgent" }]));
    expect(f).toMatchObject({ line: 1, severity: "medium", id: "lib/a.ts:1:Long Function" });
    expect(parseFindings(JSON.stringify([{ ...raw, line: "7" }]))[0]?.line).toBe(1);
    expect(parseFindings(JSON.stringify([{ ...raw, line: 7.9 }]))[0]?.line).toBe(7);
  });

  it(`keeps at most ${String(MAX_FINDINGS)}`, () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...raw, line: i + 1 }));
    expect(parseFindings(JSON.stringify(many))).toHaveLength(MAX_FINDINGS);
  });

  it("returns nothing for prose, broken JSON or a non-array", () => {
    expect(parseFindings("no findings")).toEqual([]);
    expect(parseFindings("[not json]")).toEqual([]);
    expect(parseFindings('```json\n{"file":"a"}\n```')).toEqual([]);
  });
});

describe("the score", () => {
  it("weighs debt by severity", () => {
    expect(debt([finding({ severity: "high" }), finding({ severity: "medium" }), finding({ severity: "low" })])).toBe(6);
  });

  it("earns no band before the scout has run, so the checklist alone tops out at 90", () => {
    expect(bandScore(null)).toBe(0);
    expect(headroomScore(100, null)).toBe(90);
  });

  it("shrinks the band as debt grows: half gone at 10", () => {
    expect(bandScore(report([]))).toBe(10);
    const ten = report(Array.from({ length: 5 }, () => finding()));
    expect(bandScore(ten)).toBe(5);
    expect(headroomScore(80, ten)).toBe(77);
  });

  it("never reaches 100", () => {
    expect(headroomScore(100, report([]))).toBe(99);
  });

  it("splits into checklist and scout points, with a plain note", () => {
    expect(scoreParts(80, null)).toEqual({ checklist: 72, scout: 0 });
    expect(scoreParts(97, report(Array.from({ length: 8 }, () => finding({ severity: "high" }))))).toEqual({ checklist: 87, scout: 3 });
    expect(scoreNote(null)).toContain("stops at 90");
    expect(scoreNote(report([]))).toContain("never reaches 100");
  });
});

describe("openFindings", () => {
  it("leaves out started findings and sorts worst first, keeping the scout's order within a severity", () => {
    const a = finding({ id: "a", severity: "low" });
    const b = finding({ id: "b", severity: "high" });
    const c = finding({ id: "c", severity: "medium" });
    const d = finding({ id: "d", severity: "high" });
    expect(openFindings(report([a, b, c, d], ["c"])).map((f) => f.id)).toEqual(["b", "d", "a"]);
  });

  it("is empty without a report", () => {
    expect(openFindings(null)).toEqual([]);
  });
});

describe("the card a finding starts", () => {
  it("is titled by smell and file name", () => {
    expect(findingTitle(finding({ file: "lib/deep/runner.ts" }))).toBe("Long Function: runner.ts");
    expect(findingTitle(finding({ file: "" }))).toBe("Long Function: ");
  });

  it("has a self-contained prompt with the location, the fix and the house rules", () => {
    const p = findingPrompt(finding());
    expect(p).toContain("lib/a.ts:10: Long Function");
    expect(p).toContain("Suggested fix: Extract the loop");
    expect(p).toContain("(refactor, medium severity)");
    expect(p).toContain("git stash");
  });
});
