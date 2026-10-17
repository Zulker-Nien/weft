import { describe, expect, it, vi } from "vitest";

// The copilot's setup_status tool (lib/board-tools.ts): what isn't linked yet, for the open cards' projects or one folder.
// lib/board-tools.test.ts covers the other tools; the SDK, lib/copilot-setup and lib/copilot-sources are mocked here.

type Captured = { name: string; handler: (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }> };
const captures: Captured[] = [];
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: (options: { tools?: Captured[] }) => (captures.push(...(options.tools ?? [])), { name: "board" }),
  tool: (name: string, _description: string, _schema: unknown, handler: Captured["handler"]) => ({ name, handler }),
}));
vi.mock("./copilot-setup", () => ({ setupReport: (projects: string[]) => Promise.resolve(`gaps for ${projects.join(",")}`) }));
vi.mock("./copilot-sources", () => ({ activeProjects: () => ["/dev/weft"] }));
vi.mock("./folders", () => ({ resolveFolder: (raw: unknown) => `/abs/${String(raw)}` }));
vi.mock("./store", () => ({ DATA_DIR: "/tmp/weft-test", listCards: () => [], getCard: vi.fn(), createCard: vi.fn(), updateCard: vi.fn() }));

const { boardMcpServer, COPILOT_PROMPT, SAFE_BOARD_TOOLS } = await import("./board-tools");

describe("setup_status", () => {
  it("reports the open cards' projects by default, or one folder, without asking first", async () => {
    boardMcpServer({ start: vi.fn(), stop: async () => {}, answer: vi.fn(), isBusy: () => false });
    const tool = captures.find((t) => t.name === "setup_status");
    expect((await tool?.handler({}))?.content[0]?.text).toBe("gaps for /dev/weft");
    expect((await tool?.handler({ folder: "groovenfill" }))?.content[0]?.text).toBe("gaps for /abs/groovenfill");
    expect(SAFE_BOARD_TOOLS.has("setup_status")).toBe(true);
    expect(COPILOT_PROMPT).toContain("call setup_status");
  });
});
