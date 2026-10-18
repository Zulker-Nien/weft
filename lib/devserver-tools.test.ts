import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { content: Array<{ type: string; text?: string }>; isError?: boolean };
type Handler = (args: Record<string, unknown>) => Promise<Result>;

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: (options: { name: string; alwaysLoad?: boolean; tools: Array<{ name: string; handler: Handler }> }) => options,
  tool: (name: string, _description: string, _schema: unknown, handler: Handler) => ({ name, handler }),
}));

const dev = {
  startDev: vi.fn(),
  stopDev: vi.fn(),
  devStatus: vi.fn(),
  reachable: vi.fn(),
  findDev: vi.fn(),
  listDev: vi.fn(),
};
vi.mock("./devserver", () => dev);
vi.mock("./devserver-list", () => ({ findDev: dev.findDev, listDev: dev.listDev }));
vi.mock("./store", () => ({ DATA_DIR: "/tmp/weft-devserver-tools", getCard: vi.fn(() => ({ title: "T" })) }));

const tools = await import("./devserver-tools");
const server = tools.devserversMcpServer(() => "c1", () => "/proj") as unknown as { name: string; alwaysLoad: boolean; tools: Array<{ name: string; handler: Handler }> };
const run = (name: string, args: Record<string, unknown> = {}) => server.tools.find((t) => t.name === name)!.handler(args);
const said = (r: Result) => r.content[0]?.text;

beforeEach(() => {
  vi.mocked(dev.startDev).mockReset();
  vi.mocked(dev.stopDev).mockReset();
  vi.mocked(dev.devStatus).mockReset();
  vi.mocked(dev.reachable).mockReset();
  vi.mocked(dev.findDev).mockReset();
  vi.mocked(dev.listDev).mockReset();
});

describe("devserversMcpServer", () => {
  it("is the devservers server, loaded up front, and its prompt names every tool", () => {
    expect(server.name).toBe("devservers");
    expect(server.alwaysLoad).toBe(true);
    expect(server.tools.map((t) => t.name)).toEqual(["start", "status", "stop"]);
    expect(tools.DEVSERVERS_PROMPT).toContain("mcp__devservers__start");
    expect(tools.DEVSERVERS_PROMPT).toContain("mcp__devservers__status");
    expect(tools.DEVSERVERS_PROMPT).toContain("mcp__devservers__stop");
    expect(tools.DEVSERVERS_PROMPT).toContain("run_in_background");
  });

  it("starts a server in the project folder, polls url when given, and reports the state", async () => {
    dev.findDev.mockReturnValue(undefined);
    dev.startDev.mockResolvedValueOnce(undefined);
    dev.reachable.mockResolvedValueOnce(true);
    dev.devStatus.mockResolvedValueOnce({ state: "running", reachable: true, log: "ready on :3000" });
    const r = await run("start", { command: "npm run dev", url: "http://localhost:3000" });
    expect(dev.startDev).toHaveBeenCalledWith("c1", "npm run dev", "/proj", "T", "http://localhost:3000");
    expect(dev.reachable).toHaveBeenCalledWith("http://localhost:3000");
    expect(said(r)).toBe("Started npm run dev in /proj.\nState: running\nURL: http://localhost:3000 (reachable)\nLog:\nready on :3000");
  });

  it("gives up on the url after 60s and says it isn't up yet", async () => {
    vi.useFakeTimers();
    dev.reachable.mockResolvedValue(false);
    dev.devStatus.mockResolvedValueOnce({ state: "starting", reachable: false, log: "" });
    const pending = run("start", { command: "npm run dev", url: "http://localhost:3000" });
    await vi.advanceTimersByTimeAsync(60_000);
    const r = await pending;
    vi.useRealTimers();
    expect(dev.reachable).toHaveBeenCalledTimes(60);
    expect(said(r)).toContain("(not reachable yet)");
    expect(said(r)).toContain("(empty)");
  });

  it("reuses a live run with the same cwd and command, skipping startDev", async () => {
    dev.findDev.mockReturnValueOnce({ cardId: "other" });
    dev.reachable.mockResolvedValueOnce(false);
    dev.devStatus.mockResolvedValueOnce({ state: "running", reachable: false, log: "" });
    const r = await run("start", { command: "npm run dev" });
    expect(dev.startDev).not.toHaveBeenCalled();
    expect(said(r)).toContain("Reused npm run dev in /proj");
  });

  it("refuses a cwd outside the project folder", async () => {
    const r = await run("start", { command: "npm run dev", cwd: "/elsewhere" });
    expect(r.isError).toBe(true);
    expect(said(r)).toContain("must be inside the project folder");
    expect(dev.startDev).not.toHaveBeenCalled();
  });

  it("errors when no card is bound to the thread", async () => {
    const noCard = tools.devserversMcpServer(() => undefined, () => "/proj") as unknown as { tools: Array<{ name: string; handler: Handler }> };
    const r = await noCard.tools.find((t) => t.name === "start")!.handler({ command: "npm run dev" });
    expect([r.isError, said(r)]).toEqual([true, "No card is bound to this thread."]);
    const stopR = await noCard.tools.find((t) => t.name === "stop")!.handler({});
    expect(stopR.isError).toBe(true);
  });

  it("status lists every server", async () => {
    dev.listDev
      .mockResolvedValueOnce([
        { cardId: "a", title: "A", cwd: "/proj", command: "npm run dev", url: "http://localhost:3000", state: "running", startedAt: 1, source: "weft" },
        { cardId: "b", cwd: "/proj2", command: "next dev on port 4001", url: "http://localhost:4001", state: "running", startedAt: 0, source: "thread", taskId: "tk" },
      ])
      .mockResolvedValueOnce([]);
    const r = await run("status", {});
    expect(said(r)).toBe(
      "Dev servers (newest first):\n- weft \"A\" (a) npm run dev [running] http://localhost:3000\n- thread (b) next dev on port 4001 [running] http://localhost:4001",
    );
    expect(said(await run("status", {}))).toBe("No dev servers running.");
  });

  it("stop ends this card's run", async () => {
    const r = await run("stop", {});
    expect(dev.stopDev).toHaveBeenCalledWith("c1");
    expect(said(r)).toBe("Stopped.");
  });
});
