import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { content: Array<{ type: string; text?: string }>; isError?: boolean };
type Handler = (args: Record<string, unknown>) => Promise<Result>;

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: (options: { name: string; alwaysLoad?: boolean; tools: Array<{ name: string; handler: Handler }> }) => options,
  tool: (name: string, _description: string, _schema: unknown, handler: Handler) => ({ name, handler }),
}));

vi.stubEnv("THREADBOARD_SHELL_URL", "http://127.0.0.1:4567");
vi.mock("./shell-token", () => ({ shellToken: () => "tok" }));
const st = await import("./secret-tools");

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const reply = (data: Record<string, unknown>, ok = true) => fetchMock.mockResolvedValueOnce({ ok, statusText: "Bad", json: () => Promise.resolve(data) });
const sent = () => {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, body: JSON.parse(init.body as string) as Record<string, unknown> };
};

const server = st.secretsMcpServer(() => "c1", () => "/proj") as unknown as { name: string; alwaysLoad: boolean; tools: Array<{ name: string; handler: Handler }> };
const run = (name: string, args: Record<string, unknown> = {}) => server.tools.find((t) => t.name === name)!.handler(args);
const said = (r: Result) => r.content[0]?.text;

beforeEach(() => fetchMock.mockReset());

describe("secretsMcpServer", () => {
  it("is the secrets server, loaded up front, and its prompt says never to see a value", () => {
    expect(server.name).toBe("secrets");
    expect(server.alwaysLoad).toBe(true);
    expect(st.SECRETS_PROMPT).toContain("mcp__secrets__fill_field");
    expect(st.SECRETS_PROMPT).toContain("mcp__secrets__run");
    expect(server.tools.map((t) => t.name)).toEqual(["list", "fill_field", "run"]);
  });

  it("lists names for the card's folder, or another project's", async () => {
    reply({ label: "aimhuge/weft", secrets: [{ name: "GITHUB_CLIENT_ID", environment: "development", missing: false }, { name: "GITHUB_CLIENT_SECRET", environment: "production", missing: true }] });
    const r = await run("list");
    expect(sent()).toEqual({ url: "http://127.0.0.1:4567/secrets/list", body: { folder: "/proj" } });
    expect(said(r)).toBe("Secrets in the aimhuge/weft vault (names only):\n- GITHUB_CLIENT_ID (development)\n- GITHUB_CLIENT_SECRET (production): missing, no value yet");

    fetchMock.mockReset();
    reply({ label: "other" });
    expect(said(await run("list", { project: "/other" }))).toContain("The other vault has no secrets yet");
    expect(sent().body).toEqual({ folder: "/other" });
  });

  it("fills a field and says so without the value", async () => {
    reply({ found: true, label: "aimhuge/weft" });
    const r = await run("fill_field", { name: "GITHUB_CLIENT_SECRET", selector: "#secret" });
    expect(sent()).toEqual({
      url: "http://127.0.0.1:4567/secrets/fill",
      body: { key: "c1", folder: "/proj", name: "GITHUB_CLIENT_SECRET", environment: "development", selector: "#secret" },
    });
    expect(r.isError).toBe(false);
    expect(said(r)).toBe("Typed GITHUB_CLIENT_SECRET from the aimhuge/weft vault into #secret.");
    // The card's stored tool results go through redaction from now on.
    expect((await import("./secret-run")).usesSecrets("c1")).toBe(true);
  });

  it("reports a no, a missing value, a missing field and a shell error", async () => {
    reply({ denied: true });
    expect(said(await run("fill_field", { name: "K", selector: "#k" }))).toBe("The user didn't approve K. Ask before trying again.");
    reply({ missing: true, label: "x" });
    expect(said(await run("fill_field", { name: "K", selector: "#k", environment: "production", project: "/x" }))).toBe(
      "K (production) has no value in the x vault. Ask the user to add it with 🔐 on the left rail.",
    );
    reply({ missing: true });
    expect(said(await run("fill_field", { name: "K", selector: "#k" }))).toContain("in the this vault");
    reply({ found: false, label: "x" });
    const none = await run("fill_field", { name: "K", selector: "#k" });
    expect([none.isError, said(none)]).toEqual([true, "No element matches #k"]);
    reply({ error: "Secrets only go into https pages" }, false);
    expect(said(await run("fill_field", { name: "K", selector: "#k" }))).toBe("Secrets only go into https pages");
  });
});
