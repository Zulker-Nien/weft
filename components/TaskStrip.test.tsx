// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardTask } from "@/lib/tasks";

vi.mock("@/lib/use-now", () => ({ useNow: () => 10 * 60_000 }));
const api = { stopTask: vi.fn() };
const { default: TaskStrip } = await import("./TaskStrip");

afterEach(cleanup);

const task = (id: string, rest: Partial<CardTask> = {}): CardTask => ({ id, kind: "agent", description: `Audit ${id}`, status: "running", startedAt: 0, ...rest });

describe("TaskStrip", () => {
  it("draws nothing without tasks to show", () => {
    const { container } = render(<TaskStrip cardId="c1" tasks={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("folds to a headline and opens to a row per task", async () => {
    render(<TaskStrip cardId="c1" tasks={[task("a", { toolUses: 3, lastTool: "Grep" }), task("b", { kind: "shell", background: true, status: "completed", endedAt: 9 * 60_000, summary: "No bugs" })]} />);
    const toggle = screen.getByRole("button", { name: /1 task running · 1 done/ });
    expect(screen.queryByText("Audit a")).toBeNull();
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Audit a")).toBeTruthy();
    expect(screen.getByText("10m · 3 tools")).toBeTruthy();
    expect(screen.getByText(/on Grep/)).toBeTruthy();
    expect(screen.getByText(/No bugs/)).toBeTruthy();
  });

  it("shows a check instead of a spinner once nothing runs", () => {
    render(<TaskStrip cardId="c1" tasks={[task("a", { status: "lost" })]} />);
    expect(screen.getByRole("button", { name: /1 subagent: 1 cut off/ })).toBeTruthy();
  });

  it("offers no Stop where the transport can't stop a task", async () => {
    render(<TaskStrip cardId="c1" tasks={[task("a")]} />);
    await userEvent.click(screen.getByRole("button", { name: /running/ }));
    expect(screen.queryByRole("button", { name: "Stop Audit a" })).toBeNull();
  });

  it("stops a running task, and lets a failed stop be tried again", async () => {
    api.stopTask.mockReset().mockRejectedValueOnce(new Error("gone")).mockResolvedValue({ ok: true });
    render(<TaskStrip cardId="c1" onStop={api.stopTask} tasks={[task("a"), task("b", { status: "completed", endedAt: 9 * 60_000 })]} />);
    await userEvent.click(screen.getByRole("button", { name: /running/ }));
    expect(screen.queryByRole("button", { name: "Stop Audit b" })).toBeNull();
    const stop = screen.getByRole("button", { name: "Stop Audit a" });
    await userEvent.click(stop);
    expect(api.stopTask).toHaveBeenCalledWith("c1", "a");
    expect((stop as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(stop);
    expect((stop as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("stopping")).toBeTruthy();
  });
});
