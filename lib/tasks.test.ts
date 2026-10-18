import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { applyTaskMessage, hasLiveBackground, isDevServerTask, KEEP_ENDED, orphanTasks, runningTasks, STALE_MS, taskKind, taskNote, tracked, type CardTask } from "./tasks";

const sys = (subtype: string, rest: Record<string, unknown>) => ({ type: "system", subtype, uuid: "u", session_id: "s", ...rest }) as unknown as SDKMessage;
const startedMsg = (id: string, rest: Record<string, unknown> = {}) => sys("task_started", { task_id: id, description: `task ${id}`, ...rest });
const task = (id: string, rest: Partial<CardTask> = {}): CardTask => ({ id, kind: "agent", description: `task ${id}`, status: "running", startedAt: 0, ...rest });

describe("taskKind", () => {
  it("reads the CLI's task types", () => {
    expect(taskKind(undefined)).toBe("other");
    expect(taskKind("local_agent")).toBe("agent");
    expect(taskKind("local_bash")).toBe("shell");
    expect(taskKind("remote_shell")).toBe("shell");
    expect(taskKind("monitor")).toBe("monitor");
    expect(taskKind("local_workflow")).toBe("workflow");
    expect(taskKind("mcp_task")).toBe("other");
  });
});

describe("applyTaskMessage", () => {
  it("ignores messages that aren't about tasks", () => {
    expect(applyTaskMessage([], { type: "assistant" } as unknown as SDKMessage, 1)).toBeUndefined();
    expect(applyTaskMessage([], sys("init", {}), 1)).toBeUndefined();
  });

  it("adds a started task, newest first, replacing one with the same id", () => {
    const one = applyTaskMessage(undefined, startedMsg("a", { task_type: "local_agent", subagent_type: "Explore", tool_use_id: "t1", is_backgrounded: false }), 5);
    expect(one).toEqual([{ id: "a", toolUseId: "t1", kind: "agent", description: "task a", subagentType: "Explore", background: false, status: "running", startedAt: 5 }]);
    const two = applyTaskMessage(one, startedMsg("b", { task_type: "local_workflow", workflow_name: "spec" }), 6);
    expect(two?.map((t) => [t.id, t.kind, t.description])).toEqual([["b", "workflow", "spec"], ["a", "agent", "task a"]]);
    expect(applyTaskMessage(two, startedMsg("a"), 7)?.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("leaves ambient and housekeeping tasks out", () => {
    expect(applyTaskMessage([], startedMsg("a", { ambient: true }), 1)).toBeUndefined();
    expect(applyTaskMessage([], startedMsg("a", { skip_transcript: true }), 1)).toBeUndefined();
  });

  it("merges progress, or makes the task it missed the start of", () => {
    const usage = { total_tokens: 1200, tool_uses: 3, duration_ms: 4000 };
    const known = applyTaskMessage([task("a")], sys("task_progress", { task_id: "a", description: "x", usage, last_tool_name: "Grep", summary: "Reading lib" }), 10);
    expect(known?.[0]).toMatchObject({ tokens: 1200, toolUses: 3, lastTool: "Grep", summary: "Reading lib", status: "running" });
    const bare = applyTaskMessage([task("a")], sys("task_progress", { task_id: "a", description: "x", usage }), 10);
    expect(bare?.[0]).not.toHaveProperty("lastTool");
    const fresh = applyTaskMessage([], sys("task_progress", { task_id: "z", tool_use_id: "t", description: "Audit", subagent_type: "Plan", usage }), 10_000);
    expect(fresh?.[0]).toMatchObject({ id: "z", toolUseId: "t", kind: "agent", subagentType: "Plan", startedAt: 6000, tokens: 1200 });
    const plain = applyTaskMessage([], sys("task_progress", { task_id: "y", description: "sleep", usage }), 10_000);
    expect(plain?.[0]).toMatchObject({ kind: "other" });
    expect(plain?.[0]).not.toHaveProperty("toolUseId");
  });

  it("applies updates: ended states, backgrounding, errors", () => {
    const up = (patch: Record<string, unknown>) => applyTaskMessage([task("a")], sys("task_updated", { task_id: "a", patch }), 1)?.[0];
    expect(up({ status: "completed", end_time: 50 })).toMatchObject({ status: "completed", endedAt: 50 });
    const both = applyTaskMessage([task("a"), task("b")], sys("task_updated", { task_id: "b", patch: { status: "completed" } }), 1);
    expect(both?.map((t) => t.status)).toEqual(["running", "completed"]);
    expect(up({ status: "killed" })).toMatchObject({ status: "stopped" });
    expect(up({ status: "failed", error: "boom" })).toMatchObject({ status: "failed", summary: "boom" });
    expect(up({ status: "paused" })).toMatchObject({ status: "running" });
    expect(up({ is_backgrounded: true, description: "renamed" })).toMatchObject({ background: true, description: "renamed" });
    expect(up({})).toEqual(task("a"));
    expect(applyTaskMessage([], sys("task_updated", { task_id: "nope", patch: { status: "completed" } }), 1)).toBeUndefined();
  });

  it("settles a task on its notification", () => {
    const usage = { total_tokens: 9000, tool_uses: 12, duration_ms: 1 };
    const done = applyTaskMessage([task("a")], sys("task_notification", { task_id: "a", status: "completed", summary: "Found 3 bugs", output_file: "/tmp/a.out", usage }), 99);
    expect(done?.[0]).toMatchObject({ status: "completed", endedAt: 99, summary: "Found 3 bugs", outputFile: "/tmp/a.out", tokens: 9000, toolUses: 12 });
    const bare = applyTaskMessage([task("a")], sys("task_notification", { task_id: "a", status: "failed", summary: "", output_file: "" }), 99);
    expect(bare?.[0]).toEqual({ ...task("a"), status: "failed", endedAt: 99 });
    const orphan = applyTaskMessage([task("a")], sys("task_notification", { task_id: "a", status: "stopped", reason: "worker_restart", summary: "", output_file: "" }), 99);
    expect(orphan?.[0]).toMatchObject({ status: "lost", told: false, endedAt: 99 });
  });

  it("reads a resumed CLI's orphaned-by-process-exit stop as lost, told once", () => {
    const summary = "Orphaned by a previous Claude Code process exit and reported in an aggregate summary.";
    const stop = (s: string | undefined, status = "stopped") => sys("task_notification", { task_id: "a", status, summary: s, output_file: "" });
    const bg = task("a", { kind: "shell", background: true });
    const fresh = applyTaskMessage([bg], stop(summary), 99)?.[0];
    expect(fresh).toMatchObject({ status: "lost", told: false, endedAt: 99, summary });
    expect(taskNote([fresh!])?.note).toContain("task a");
    // Weft already marked it lost at the exit and told the thread: it stays told, with its cut-off time.
    const told = applyTaskMessage([{ ...bg, status: "lost", told: true, endedAt: 50 }], stop(summary), 99)?.[0];
    expect(told).toMatchObject({ status: "lost", told: true, endedAt: 50 });
    expect(taskNote([told!])).toBeUndefined();
    const noTime = applyTaskMessage([{ ...bg, status: "lost", told: true }], stop(summary), 99)?.[0];
    expect(noTime).toMatchObject({ status: "lost", told: true, endedAt: 99 });
    // A plain stop, or a failure that mentions it, is what it says.
    expect(applyTaskMessage([bg], stop("Stopped by user"), 99)?.[0]).toMatchObject({ status: "stopped" });
    expect(applyTaskMessage([bg], stop(undefined), 99)?.[0]).toMatchObject({ status: "stopped" });
    expect(applyTaskMessage([bg], stop(summary, "failed"), 99)?.[0]).toMatchObject({ status: "failed" });
    expect(applyTaskMessage([bg], stop(summary), 99)?.[0]).not.toHaveProperty("outputFile");
  });

  it("leaves out a notification for a task it never saw start", () => {
    expect(applyTaskMessage([], sys("task_notification", { task_id: "n", status: "completed", summary: "ok", output_file: "" }), 7)).toBeUndefined();
  });

  it("reconciles against the live background set", () => {
    const tasks = [task("bg", { background: true }), task("fg", { background: false }), task("old", { background: true, status: "completed" }), task("moved")];
    const next = applyTaskMessage(tasks, sys("background_tasks_changed", { tasks: [
      { task_id: "moved", task_type: "local_agent", description: "moved" },
      { task_id: "new", task_type: "local_bash", description: "npm test", subagent_type: undefined },
      { task_id: "new2", task_type: "local_agent", description: "Explore", subagent_type: "Explore" },
      { task_id: "amb", task_type: "monitor", description: "watch", ambient: true },
    ] }), 42);
    const byId = new Map(next?.map((t) => [t.id, t]));
    expect(byId.get("bg")).toMatchObject({ status: "ended", endedAt: 42 });
    expect(byId.get("fg")?.status).toBe("running");
    expect(byId.get("old")?.status).toBe("completed");
    expect(byId.get("moved")?.background).toBe(true);
    expect(byId.get("new")).toEqual({ id: "new", kind: "shell", description: "npm test", background: true, status: "running", startedAt: 42 });
    expect(byId.get("new2")?.subagentType).toBe("Explore");
    expect(byId.has("amb")).toBe(false);
  });

  it("returns undefined when the live set changes nothing", () => {
    const tasks = [task("bg", { background: true })];
    expect(applyTaskMessage(tasks, sys("background_tasks_changed", { tasks: [{ task_id: "bg", task_type: "local_bash", description: "x" }] }), 1)).toBeUndefined();
  });

  it("keeps every running task but only the newest ended ones", () => {
    const ended = Array.from({ length: KEEP_ENDED + 5 }, (_, i) => task(`e${i}`, { status: "completed" }));
    const next = applyTaskMessage([task("r"), ...ended], startedMsg("new"), 1);
    expect(next?.filter((t) => t.status === "running").map((t) => t.id)).toEqual(["new", "r"]);
    expect(next?.filter((t) => t.status !== "running")).toHaveLength(KEEP_ENDED);
  });
});

describe("tracked", () => {
  it("tracks agents and background tasks, not foreground commands", () => {
    expect(tracked(task("a"))).toBe(true);
    expect(tracked(task("bg", { kind: "shell", background: true }))).toBe(true);
    expect(tracked(task("fg", { kind: "shell", background: false }))).toBe(false);
    expect(tracked(task("fg", { kind: "other" }))).toBe(false);
  });

  it("drops ended foreground commands when the ledger is trimmed, keeping running ones", () => {
    const next = applyTaskMessage([task("fg", { kind: "shell", status: "completed" }), task("fg2", { kind: "shell" }), task("a", { status: "completed" })], startedMsg("new"), 1);
    expect(next?.map((t) => t.id)).toEqual(["new", "fg2", "a"]);
  });
});

describe("orphanTasks", () => {
  it("marks running tasks lost, or returns undefined when none ran", () => {
    expect(orphanTasks(undefined, 1)).toBeUndefined();
    expect(orphanTasks([task("a", { status: "completed" })], 1)).toBeUndefined();
    const next = orphanTasks([task("a"), task("b", { status: "failed" })], 9);
    expect(next?.[0]).toMatchObject({ status: "lost", endedAt: 9, told: false });
    expect(next?.[1]?.status).toBe("failed");
  });
});

describe("runningTasks and hasLiveBackground", () => {
  it("finds the running ones and the live background ones", () => {
    expect(runningTasks()).toEqual([]);
    expect(runningTasks([task("a"), task("b", { status: "lost" }), task("fg", { kind: "shell" })]).map((t) => t.id)).toEqual(["a"]);
    expect(hasLiveBackground(undefined, 1)).toBe(false);
    expect(hasLiveBackground([task("fg")], 1)).toBe(false);
    expect(hasLiveBackground([task("bg", { background: true })], 1)).toBe(true);
    expect(hasLiveBackground([task("bg", { background: true })], STALE_MS + 1)).toBe(false);
    expect(hasLiveBackground([task("bg", { background: true, status: "completed" })], 1)).toBe(false);
  });
});

describe("taskNote", () => {
  it("has nothing to say without untold lost tasks", () => {
    expect(taskNote()).toBeUndefined();
    expect(taskNote([task("a"), task("b", { status: "lost", told: true })])).toBeUndefined();
    expect(taskNote([task("fg", { kind: "shell", status: "lost" })])).toBeUndefined();
  });

  it("names one lost task and marks it told", () => {
    const at = new Date(2026, 9, 17, 7, 5).getTime();
    const taken = taskNote([task("a", { status: "lost", startedAt: at, endedAt: at + 60 * 60_000, kind: "shell", background: true }), task("b")]);
    expect(taken?.note).toContain("a background task of this thread ended");
    expect(taken?.note).toContain(`- "task a" (shell, started 07:05, cut off 08:05)`);
    expect(taken?.note).toContain("Don't wait on it");
    expect(taken?.tasks[0]?.told).toBe(true);
    expect(taken?.tasks[1]?.told).toBeUndefined();
  });

  it("lists several, with agent types and output files", () => {
    const at = new Date(2026, 9, 17, 9, 0).getTime();
    const taken = taskNote([
      task("a", { status: "lost", startedAt: at, subagentType: "Explore", outputFile: "/tmp/a.out" }),
      task("b", { status: "lost", startedAt: at }),
    ]);
    expect(taken?.note).toContain("2 background tasks");
    expect(taken?.note).toContain("Don't wait on them");
    expect(taken?.note).toContain(`- "task a" (agent, Explore, started 09:00; partial output in /tmp/a.out)`);
    expect(taken?.note.endsWith("]\n\n")).toBe(true);
  });
});

describe("isDevServerTask", () => {
  it("matches shell tasks whose description looks like a dev server", () => {
    const shell = (d: string): CardTask => ({ id: "x", kind: "shell", description: d, background: true, status: "running", startedAt: 0 });
    expect(isDevServerTask(shell("npm run dev"))).toBe(true);
    expect(isDevServerTask(shell("pnpm dev"))).toBe(true);
    expect(isDevServerTask(shell("next dev"))).toBe(true);
    expect(isDevServerTask(shell("vite"))).toBe(true);
    expect(isDevServerTask(shell("npm run dev on port 4001"))).toBe(true);
    expect(isDevServerTask(shell("ready at localhost:5173"))).toBe(true);
  });
  it("ignores non-shell tasks and other commands", () => {
    const agent: CardTask = { id: "x", kind: "agent", description: "next dev", background: true, status: "running", startedAt: 0 };
    const other: CardTask = { id: "x", kind: "shell", description: "npm test", background: true, status: "running", startedAt: 0 };
    expect(isDevServerTask(agent)).toBe(false);
    expect(isDevServerTask(other)).toBe(false);
  });
});
