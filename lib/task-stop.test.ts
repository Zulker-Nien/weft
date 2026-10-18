import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";
import type { CardTask } from "./tasks";

const cards = new Map<string, Partial<Card>>();
const sessions = new Map<string, { query?: { stopTask: (id: string) => Promise<void> } }>();
vi.mock("./store", () => ({
  getCard: (id: string) => cards.get(id),
  updateCard: (id: string, patch: Partial<Card>) => cards.set(id, { ...cards.get(id), ...patch }),
}));
vi.mock("./runner-state", () => ({ sessions }));

const { stopTask } = await import("./task-stop");

const task = (status: CardTask["status"] = "running"): CardTask => ({ id: "t", kind: "shell", description: "Dev server", background: true, status, startedAt: 1 });

beforeEach(() => {
  cards.clear();
  sessions.clear();
});

describe("stopTask", () => {
  it("asks the card's CLI to stop a running task and leaves the record to its notification", async () => {
    const stop = vi.fn(async () => {});
    cards.set("c", { tasks: [task()] });
    sessions.set("c", { query: { stopTask: stop } });
    await stopTask("c", "t");
    expect(stop).toHaveBeenCalledWith("t");
    expect(cards.get("c")?.tasks?.[0]?.status).toBe("running");
  });

  it("marks the task stopped when there's no CLI, or the CLI refuses", async () => {
    cards.set("c", { tasks: [task()] });
    await stopTask("c", "t");
    expect(cards.get("c")?.tasks?.[0]?.status).toBe("stopped");
    expect(cards.get("c")?.tasks?.[0]?.endedAt).toBeTypeOf("number");
    cards.set("d", { tasks: [task()] });
    sessions.set("d", { query: { stopTask: () => Promise.reject(new Error("unknown task")) } });
    await stopTask("d", "t");
    expect(cards.get("d")?.tasks?.[0]?.status).toBe("stopped");
  });

  it("leaves a card that went away while the CLI was asked", async () => {
    cards.set("c", { tasks: [task()] });
    sessions.set("c", { query: { stopTask: () => { cards.delete("c"); return Promise.reject(new Error("gone")); } } });
    await stopTask("c", "t");
    expect(cards.has("c")).toBe(false);
  });

  it("does nothing for a missing card, an unknown task or one that already ended", async () => {
    const stop = vi.fn(async () => {});
    sessions.set("c", { query: { stopTask: stop } });
    await stopTask("missing", "t");
    cards.set("c", { tasks: [task("completed")] });
    await stopTask("c", "t");
    await stopTask("c", "other");
    expect(stop).not.toHaveBeenCalled();
    expect(cards.get("c")?.tasks?.[0]?.status).toBe("completed");
  });
});
