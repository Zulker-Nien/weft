import { describe, expect, it } from "vitest";
import { BRANCHES, branchComplete, branchProgress, CHECKS, productionReady, setupPrompt, type ProjectReport } from "./project-badges";

const report = (ok: Record<string, boolean>): ProjectReport => ({ root: "/a", name: "app", stack: [], ok, score: 0, coverage: null, perfect: false, clean: false });

describe("the production-ready tree", () => {
  it("has five branches, each with checks, and unique check ids", () => {
    expect(BRANCHES.map((b) => b.id)).toEqual(["testing", "security", "observability", "docs", "delivery"]);
    for (const b of BRANCHES) expect(CHECKS.some((c) => c.branch === b.id)).toBe(true);
    expect(new Set(CHECKS.map((c) => c.id)).size).toBe(CHECKS.length);
  });

  it("counts a branch's progress and completion", () => {
    const r = report({ readme: true, license: true });
    expect(branchProgress(r, "docs")).toEqual({ done: 2, total: 5 });
    expect(branchComplete(r, "docs")).toBe(false);
    const docs = Object.fromEntries(CHECKS.filter((c) => c.branch === "docs").map((c) => [c.id, true]));
    expect(branchComplete(report(docs), "docs")).toBe(true);
    expect(productionReady(report(docs))).toBe(false);
    expect(productionReady(report(Object.fromEntries(CHECKS.map((c) => [c.id, true]))))).toBe(true);
  });

  it("writes a setup prompt naming the badge and project", () => {
    const check = CHECKS.find((c) => c.id === "errors");
    if (!check) throw new Error("no errors check");
    const prompt = setupPrompt(check, { name: "deckcp" });
    expect(prompt).toContain("Sentry");
    expect(prompt).toContain('"Error tracking" badge');
    expect(prompt).toContain("deckcp");
  });
});
