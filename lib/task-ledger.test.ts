import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Card } from "./types";

const cards = new Map<string, Partial<Card>>();
vi.mock("./store", () => ({
  getCard: (id: string) => cards.get(id),
  updateCard: (id: string, patch: Partial<Card>) => cards.set(id, { ...cards.get(id), ...patch }),
}));

const { hasLiveTasks, loseTasks, recordTask, takeTaskNote } = await import("./task-ledger");

const started = { type: "system", subtype: "task_started", task_id: "a", description: "Audit", is_backgrounded: true } as unknown as SDKMessage;

beforeEach(() => cards.clear());

describe("task-ledger", () => {
  it("records task messages on the card and skips the rest", () => {
    recordTask("missing", started);
    expect(cards.has("missing")).toBe(false);
    cards.set("c", {});
    recordTask("c", { type: "system", subtype: "init" } as unknown as SDKMessage);
    expect(cards.get("c")?.tasks).toBeUndefined();
    recordTask("c", started);
    expect(cards.get("c")?.tasks?.[0]).toMatchObject({ id: "a", status: "running", background: true });
    expect(hasLiveTasks("c")).toBe(true);
    expect(hasLiveTasks("missing")).toBe(false);
  });

  it("loses running tasks with the CLI and tells the next message once", () => {
    cards.set("c", {});
    expect(takeTaskNote("c")).toBe("");
    loseTasks("c");
    expect(cards.get("c")?.tasks).toBeUndefined();
    recordTask("c", started);
    loseTasks("c");
    expect(cards.get("c")?.tasks?.[0]?.status).toBe("lost");
    expect(hasLiveTasks("c")).toBe(false);
    expect(takeTaskNote("c")).toContain(`"Audit"`);
    expect(takeTaskNote("c")).toBe("");
  });
});
