import { beforeEach, describe, expect, it, vi } from "vitest";

// The restart_weft_when_idle tool every board thread gets (lib/restart-tool.ts, registered in lib/board-tools.ts), against a fake SDK that hands back each
// registered tool, and lib/restart-when-idle mocked.

interface CapturedTool {
  name: string;
  handler: (args: Record<string, unknown>) => Promise<{ content: { type: "text"; text: string }[]; isError?: true }>;
}

const captures: CapturedTool[] = [];
const armRestart = vi.hoisted(() => vi.fn<() => { armed: boolean; waiting: { id: string; title: string }[] }>());

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: (options: { tools?: CapturedTool[] }) => {
    captures.push(...(options.tools ?? []));
    return { name: "board" };
  },
  tool: (name: string, _description: string, _schema: unknown, handler: CapturedTool["handler"]) => ({ name, handler }),
}));
vi.mock("./restart-when-idle", () => ({ armRestart }));
vi.mock("./store", () => ({ createCard: vi.fn(), getCard: vi.fn(), getThread: vi.fn(() => []), listCards: vi.fn(() => []), updateCard: vi.fn() }));
vi.mock("./tag-store", () => ({ rememberTags: vi.fn() }));
vi.mock("./settings", () => ({ touchProject: vi.fn(), defaultPermissionMode: () => "auto", automations: () => [] }));

const { SAFE_BOARD_TOOLS, describeBoardTool, isTrustedTool, threadBoardMcpServer } = await import("./board-tools");
const { restartTool } = await import("./restart-tool");

const waiting = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `w${i}`, title: `Card ${i}` }));

const run = () => (restartTool() as unknown as CapturedTool).handler({});

beforeEach(() => {
  captures.length = 0;
  armRestart.mockReset();
});

describe("restart_weft_when_idle", () => {
  it("arms the restart and says it waits on the one running turn", async () => {
    armRestart.mockReturnValue({ armed: true, waiting: waiting(1) });
    const r = await run();
    expect(armRestart).toHaveBeenCalledTimes(1);
    expect(r.isError).toBeUndefined();
    expect(r.content[0]?.text).toBe(
      "Weft restarts once the 1 running turn ends (yours included). Finish your reply; this thread doesn't carry on by itself after the restart.",
    );
  });

  it("counts several running turns in the plural", async () => {
    armRestart.mockReturnValue({ armed: true, waiting: waiting(3) });
    expect((await run()).content[0]?.text).toContain("once the 3 running turns end (yours included)");
  });

  it("returns the error as an error result when it can't arm (no desktop app)", async () => {
    armRestart.mockImplementation(() => {
      throw new Error("Restarting Weft needs the desktop app.");
    });
    const r = await run();
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toBe("Restarting Weft needs the desktop app.");
  });

  it("is registered on every board thread's server", () => {
    threadBoardMcpServer(() => "parent-1", { start: vi.fn() });
    expect(captures.map((x) => x.name)).toContain("restart_weft_when_idle");
  });

  it("needs the user's OK: not a safe board tool, and described without a card", () => {
    expect(SAFE_BOARD_TOOLS.has("restart_weft_when_idle")).toBe(false);
    expect(isTrustedTool("mcp__board__restart_weft_when_idle", "sdk")).toBe(false);
    expect(describeBoardTool("mcp__board__restart_weft_when_idle", {})).toBe("Restart Weft once the running threads finish");
  });
});
