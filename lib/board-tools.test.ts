import { beforeEach, describe, expect, it, vi } from "vitest";

const created: Record<string, unknown>[] = [];
vi.mock("./store", () => ({
  createCard: (input: Record<string, unknown>) => {
    const card = { id: "new-1", column: "backlog", ...input };
    created.push(card);
    return card;
  },
  getCard: () => undefined,
  getThread: () => [],
  listCards: () => [],
  updateCard: () => undefined,
}));
vi.mock("./settings", () => ({ touchProject: vi.fn() }));

const { createBoardCard } = await import("./board-tools");

describe("createBoardCard", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("titles from the prompt, resolves the folder and records the parent", () => {
    const card = createBoardCard({ prompt: "Fix the flicker", folder: "/tmp", permissionMode: "default", parentId: "p1" });
    expect(card).toMatchObject({ title: "Fix the flicker", cwd: "/tmp", backend: "claude", parentId: "p1" });
  });

  it("keeps an explicit title and cli", () => {
    const card = createBoardCard({ prompt: "x", title: " Mine ", folder: "/tmp", cli: "puku", permissionMode: "auto" });
    expect(card).toMatchObject({ title: "Mine", backend: "puku", permissionMode: "auto" });
  });

  it("rejects a folder that doesn't exist, creating nothing", () => {
    expect(() => createBoardCard({ prompt: "x", folder: "/no/such/dir", permissionMode: "default" })).toThrow();
    expect(created).toHaveLength(0);
  });
});
