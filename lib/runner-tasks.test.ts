// @vitest-environment node
// A background task's end gets a row in the thread (lib/runner-tasks.ts), against the fake SDK in lib/runner.harness.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, makeCard, nth, resetHarness } from "./runner.harness";
import type { ThreadItem } from "./types";

const h = await vi.hoisted(async () => (await import("./runner.harness")).harnessState());

vi.mock("@anthropic-ai/claude-agent-sdk", async () => (await import("./runner.harness")).sdkMock(h));
vi.mock("./store", async () => (await import("./runner.harness")).storeMock(h));
vi.mock("./bus", async () => (await import("./runner.harness")).busMock(h));
vi.mock("./env", async () => (await import("./runner.harness")).envMock());
vi.mock("./import", async () => (await import("./runner.harness")).importMock(h));
vi.mock("./settings", async () => (await import("./runner.harness")).settingsMock(h));
vi.mock("./login", async () => (await import("./runner.harness")).loginMock(h));
vi.mock("./automations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./automations")>()),
  skillsForPrompt: () => h.skillsForPrompt,
}));
vi.mock("node:child_process", async (importOriginal) =>
  (await import("./runner.harness")).childProcessMock(h, await importOriginal<typeof import("node:child_process")>()),
);

let runner: typeof import("./runner");
let cwd: string;
const notifications = (id: string) => (h.threads.get(id) ?? []).filter((i): i is Extract<ThreadItem, { kind: "notification" }> => i.kind === "notification");

beforeEach(async () => {
  cwd = resetHarness(h);
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
  vi.restoreAllMocks();
});

const started = (task_id: string, is_backgrounded: boolean) => ({ type: "system", subtype: "task_started", task_id, is_backgrounded, description: "d" });
const ended = (task_id: string, extra: Record<string, unknown> = {}) => ({
  type: "system",
  subtype: "task_notification",
  task_id,
  status: "completed",
  output_file: "/tmp/out",
  summary: `Background command "${task_id}" completed (exit code 0)`,
  ...extra,
});

async function open() {
  makeCard(h, cwd, { id: "c1" });
  runner.sendMessage("c1", "hello");
  await flush();
  return nth(h.queries, -1, "query");
}

describe("a background task's notification", () => {
  it("shows in the thread when a task started in the background ends", async () => {
    const q = await open();
    q.emit(started("b1", true));
    q.emit(ended("b1"));
    await flush();
    const [row, ...rest] = notifications("c1");
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ kind: "notification", status: "completed", summary: 'Background command "b1" completed (exit code 0)' });
    expect(typeof row?.at).toBe("number");
  });

  it("counts a task moved to the background, or listed there, and shows each end once", async () => {
    const q = await open();
    q.emit(started("f1", false));
    q.emit({ type: "system", subtype: "task_updated", task_id: "f1", patch: { is_backgrounded: true } });
    q.emit({ type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "l1", task_type: "local_bash", description: "d" }] });
    q.emit(ended("f1", { status: "failed", summary: "  " }));
    q.emit(ended("l1", { status: "stopped" }));
    q.emit(ended("l1"));
    await flush();
    expect(notifications("c1").map((n) => [n.status, n.summary])).toEqual([
      ["failed", "A background task ended"],
      ["stopped", 'Background command "l1" completed (exit code 0)'],
    ]);
  });

  it("leaves out foreground tasks, other updates, and tasks the agent never hears about", async () => {
    const q = await open();
    q.emit(started("f1", false));
    q.emit({ type: "system", subtype: "task_updated", task_id: "f1", patch: { status: "completed" } });
    q.emit(ended("f1"));
    q.emit(started("s1", true));
    q.emit(ended("s1", { skip_transcript: true }));
    q.emit(ended("unknown"));
    q.emit({ type: "system", subtype: "commands_changed", commands: [] });
    await flush();
    expect(notifications("c1")).toEqual([]);
  });
});
