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
vi.mock("./settings", () => ({ touchProject: vi.fn(), defaultPermissionMode: () => "auto" }));

const { createBoardCard, isTrustedTool } = await import("./board-tools");

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

describe("isTrustedTool", () => {
  it("trusts Weft's own in-process tools: the browser pane and the safe board tools", () => {
    expect(isTrustedTool("mcp__browser__navigate", "sdk")).toBe(true);
    expect(isTrustedTool("mcp__board__list_cards", "sdk")).toBe(true);
    expect(isTrustedTool("mcp__board__create_card", "sdk")).toBe(true);
  });

  it("asks for board tools that run agents, and for anything else", () => {
    expect(isTrustedTool("mcp__board__start_card", "sdk")).toBe(false);
    expect(isTrustedTool("mcp__board__reply", "sdk")).toBe(false);
    expect(isTrustedTool("Bash", "sdk")).toBe(false);
  });

  it("never trusts a tool from a server that isn't in-process, whatever its name", () => {
    expect(isTrustedTool("mcp__browser__navigate", "stdio")).toBe(false);
    expect(isTrustedTool("mcp__board__list_cards", undefined)).toBe(false);
  });
});
