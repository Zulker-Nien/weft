import { describe, expect, it } from "vitest";
import type { CardTask } from "./tasks";
import { CUT_OFF_HINT, RECENT_MS, runningBadge, taskDuration, taskStripView } from "./tasks-view";

const task = (id: string, rest: Partial<CardTask> = {}): CardTask => ({ id, kind: "agent", description: `task ${id}`, status: "running", startedAt: 0, ...rest });

describe("taskDuration", () => {
  it("reads seconds, minutes and hours", () => {
    expect(taskDuration(-5)).toBe("0s");
    expect(taskDuration(42_000)).toBe("42s");
    expect(taskDuration(6 * 60_000)).toBe("6m");
    expect(taskDuration(80 * 60_000)).toBe("1h 20m");
    expect(taskDuration(120 * 60_000)).toBe("2h");
  });
});

describe("taskStripView", () => {
  it("shows nothing without tasks worth showing", () => {
    expect(taskStripView(undefined, 1)).toBeUndefined();
    expect(taskStripView([task("old", { status: "completed", endedAt: 0 })], RECENT_MS + 1)).toBeUndefined();
    expect(taskStripView([task("told", { status: "lost", told: true, endedAt: 0 })], RECENT_MS + 1)).toBeUndefined();
    expect(taskStripView([task("fg", { kind: "shell" })], 1)).toBeUndefined();
  });

  it("puts running tasks first with counts in the headline", () => {
    const now = 10 * 60_000;
    const view = taskStripView([
      task("done", { kind: "shell", background: true, status: "completed", startedAt: 60_000, endedAt: 3 * 60_000, summary: "3 bugs", outputFile: "/tmp/o", toolUses: 1, tokens: 800 }),
      task("r1", { startedAt: 0, toolUses: 14, tokens: 32_000, lastTool: "Grep", subagentType: "Explore", background: true }),
      task("r2", { startedAt: 5 * 60_000, kind: "shell", background: true, summary: "task r2" }),
      task("lost", { status: "lost", endedAt: undefined }),
    ], now);
    expect(view?.running).toBe(2);
    expect(view?.headline).toBe("2 tasks running · 1 done · 1 cut off");
    expect(view?.rows.map((r) => r.id)).toEqual(["r2", "r1", "done", "lost"]);
    expect(view?.hint).toBe(CUT_OFF_HINT);
    expect(taskStripView([task("a")], 1)).not.toHaveProperty("hint");
    expect(taskStripView([task("a", { status: "lost", told: true, endedAt: 1 })], 2)).not.toHaveProperty("hint");
    expect(view?.rows[1]).toMatchObject({ kind: "agent · Explore · bg", meta: "10m · 14 tools · 32k tok", detail: "on Grep", label: "running", tone: "text-accent" });
    expect(view?.rows[2]).toMatchObject({ meta: "2m · 1 tool · 800 tok", detail: "3 bugs", outputFile: "/tmp/o", label: "done" });
    expect(view?.rows[0]).not.toHaveProperty("detail");
    const agent = taskStripView([task("a", { status: "completed", endedAt: now, summary: "This agent's report was delivered to you" })], now);
    expect(agent?.rows[0]).not.toHaveProperty("detail");
  });

  it("says how many there were once none run", () => {
    expect(taskStripView([task("a", { status: "failed", endedAt: 1 })], 2)?.headline).toBe("1 subagent: 1 failed");
    expect(taskStripView([task("a")], 1)?.headline).toBe("1 subagent running");
    expect(taskStripView([task("a", { status: "ended" })], RECENT_MS * 2)?.headline).toBe("1 subagent: 1 ended");
  });

  it("leaves running dev-server tasks out of the strip but keeps ended ones", () => {
    const now = 10 * 60_000;
    const dev = task("server", { kind: "shell", background: true, description: "next dev on port 4001", startedAt: 0 });
    const ended = task("done-server", { kind: "shell", background: true, description: "next dev", startedAt: 60_000, endedAt: 3 * 60_000, status: "completed" });
    const view = taskStripView([dev, ended, task("a")], now);
    expect(view?.running).toBe(1);
    expect(view?.rows.map((r) => r.id)).toEqual(["a", "done-server"]);
    const onlyDev = taskStripView([dev], now);
    expect(onlyDev).toBeUndefined();
  });
});

describe("runningBadge", () => {
  it("counts and names the running tasks", () => {
    expect(runningBadge()).toBeUndefined();
    expect(runningBadge([task("a", { status: "completed" })])).toBeUndefined();
    expect(runningBadge([task("a")])).toEqual({ count: 1, title: "1 subagent running: task a" });
    expect(runningBadge([task("a"), task("b")])?.title).toBe("2 subagents running: task a, task b");
    expect(runningBadge([task("a", { kind: "shell", background: true }), task("fg", { kind: "shell" })])).toEqual({ count: 1, title: "1 task running: task a" });
  });

  it("leaves running dev-server tasks out of the badge", () => {
    expect(runningBadge([task("a", { kind: "shell", background: true, description: "next dev on port 4001" })])).toBeUndefined();
    expect(runningBadge([task("a", { kind: "shell", background: true, description: "next dev on port 4001" }), task("b")])).toEqual({ count: 1, title: "1 subagent running: task b" });
  });
});
