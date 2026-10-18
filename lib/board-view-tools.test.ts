import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

type Item = { type: string; text?: string; data?: string; mimeType?: string };
type Result = { content: [Item, ...Item[]]; isError?: boolean };
type Handler = (args: Record<string, unknown>) => Promise<Result>;

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: (options: { name: string; alwaysLoad?: boolean; tools: Array<{ name: string; handler: Handler }> }) => options,
  tool: (name: string, _description: string, _schema: unknown, handler: Handler) => ({ name, handler }),
}));

vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:4567");
vi.mock("./shell-token", () => ({ shellToken: () => "tok" }));
const { boardViewMcpServer } = await import("./board-view-tools");

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const reply = (data: Record<string, unknown>, ok = true) => fetchMock.mockResolvedValueOnce({ ok, statusText: "x", json: () => Promise.resolve(data) });
const sent = () => {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, body: JSON.parse(init.body as string) as Record<string, unknown> };
};

const server = boardViewMcpServer() as unknown as { name: string; alwaysLoad: boolean; tools: Array<{ name: string; handler: Handler }> };
const run = (name: string, args: Record<string, unknown> = {}) => server.tools.find((t) => t.name === name)!.handler(args);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-board-view-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => fetchMock.mockReset());

describe("boardViewMcpServer", () => {
  it("is the board_view server, always loaded, with the five operations", () => {
    expect(server.name).toBe("board_view");
    expect(server.alwaysLoad).toBe(true);
    expect(server.tools.map((t) => t.name)).toEqual(["screenshot", "click", "hover", "type_text", "read"]);
  });

  it("screenshot returns the image, saves it and says when the highlight missed", async () => {
    reply({ png: "cG5n", found: false });
    const out = path.join(tmp, "shot");
    const r = await run("screenshot", { save_to: out, highlight: "#x" });
    expect(sent()).toEqual({ url: "http://127.0.0.1:4567/board-view/screenshot", body: { highlight: "#x" } });
    expect(r.content[0]).toEqual({ type: "image", data: "cG5n", mimeType: "image/png" });
    expect(r.content[1]?.text).toBe(`Saved to ${out}.png`);
    expect(r.content[2]?.text).toMatch(/No element matches #x/);
    expect(fs.readFileSync(`${out}.png`, "utf8")).toBe("png");
  });

  it("screenshot with neither option is just the image", async () => {
    reply({ png: "cG5n" });
    expect((await run("screenshot")).content).toHaveLength(1);
  });

  it("click, hover and type_text post their selector and confirm", async () => {
    reply({});
    expect((await run("click", { selector: "#a" })).content[0].text).toBe("Clicked #a");
    expect(sent().body).toEqual({ selector: "#a" });
    fetchMock.mockReset();
    reply({});
    expect((await run("hover", { selector: "#b" })).content[0].text).toBe("Hovering #b");
    expect(sent().url).toMatch(/\/board-view\/hover$/);
    fetchMock.mockReset();
    reply({});
    expect((await run("type_text", { selector: "#c", text: "hi" })).content[0].text).toBe("Typed into #c");
    expect(sent().body).toEqual({ selector: "#c", text: "hi" });
  });

  it("read gives the URL, title and text", async () => {
    reply({ url: "http://localhost:1000/", title: "Weft", text: "Backlog ‹secret›" });
    expect((await run("read", { selector: "main" })).content[0].text).toBe("URL: http://localhost:1000/\nTitle: Weft\n\nBacklog ‹secret›");
  });

  it("a refusal from the shell comes back as a tool error", async () => {
    reply({ error: "#reveal reveals or copies a secret value" }, false);
    const r = await run("click", { selector: "#reveal" });
    expect(r).toEqual({ content: [{ type: "text", text: "#reveal reveals or copies a secret value" }], isError: true });
  });
});
