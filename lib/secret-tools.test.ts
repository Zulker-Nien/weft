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
    expect(st.SECRETS_PROMPT).toContain("mcp__secrets__ask_add");
    expect(st.SECRETS_PROMPT).toContain("mcp__secrets__push_to_vercel");
    expect(st.SECRETS_PROMPT).toContain("mcp__secrets__add_blank");
    expect(st.SECRETS_PROMPT).toContain("mcp__secrets__set_value");
    expect(server.tools.map((t) => t.name)).toEqual(["list", "fill_field", "push_to_vercel", "set_value", "add_blank", "ask_add", "run"]);
  });

  it("lists names for the card's folder, or another project's", async () => {
    reply({ label: "aimhuge/weft", secrets: [{ name: "GITHUB_CLIENT_ID", environment: "development", missing: false }, { name: "GITHUB_CLIENT_SECRET", environment: "production", missing: true }] });
    const r = await run("list");
    expect(sent()).toEqual({ url: "http://127.0.0.1:4567/secrets/list", body: { folder: "/proj" } });
    expect(said(r)).toBe("Secrets in the aimhuge/weft vault (names only):\n- GITHUB_CLIENT_ID (development)\n- GITHUB_CLIENT_SECRET (production): blank, no value yet");

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
    // A missing value opens the 🔐 Add form with the name filled in; if the board can't, the thread is told where to add it.
    reply({ missing: true, label: "x" });
    reply({ opened: true });
    expect(said(await run("fill_field", { name: "K", selector: "#k", environment: "production", project: "/x" }))).toBe(
      "K has no value in the x vault (production). Weft opened the 🔐 Add form with K filled in: ask the user to paste its value there and click Add to vault, then try again.",
    );
    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect([url, JSON.parse(init.body as string)]).toEqual(["http://127.0.0.1:4567/secrets/ask-add", { folder: "/x", name: "K", environment: "production" }]);
    reply({ missing: true });
    reply({ error: "no board" }, false);
    expect(said(await run("fill_field", { name: "K", selector: "#k" }))).toBe(
      "K has no value in the this vault (development). Ask the user to add it with 🔐 on the left rail.",
    );
    reply({ found: false, label: "x" });
    const none = await run("fill_field", { name: "K", selector: "#k" });
    expect([none.isError, said(none)]).toEqual([true, "No element matches #k"]);
    reply({ error: "Secrets only go into https pages" }, false);
    expect(said(await run("fill_field", { name: "K", selector: "#k" }))).toBe("Secrets only go into https pages");
  });

  it("opens the 🔐 Add form for a key the task needs", async () => {
    reply({ opened: true });
    const r = await run("ask_add", { name: "SUPABASE_SECRET_KEY" });
    expect(sent()).toEqual({ url: "http://127.0.0.1:4567/secrets/ask-add", body: { folder: "/proj", name: "SUPABASE_SECRET_KEY", environment: "development" } });
    expect([r.isError, said(r)]).toEqual([
      false,
      "Opened the 🔐 Add form with SUPABASE_SECRET_KEY (development) filled in. Ask the user to paste its value there and click Add to vault; mcp__secrets__list shows it once it's in.",
    ]);
    fetchMock.mockReset();
    reply({ opened: true });
    await run("ask_add", { name: "K", environment: "production", project: "/other" });
    expect(sent().body).toEqual({ folder: "/other", name: "K", environment: "production" });
  });

  it("adds blank names to the vault and reports which were already filled", async () => {
    reply({ label: "aimhuge/weft", filled: ["GITHUB_TOKEN"] });
    const r = await run("add_blank", { names: ["GITHUB_TOKEN", "STRIPE_SECRET_KEY"], hint: "Stripe dashboard → Developers → API keys" });
    expect(sent()).toEqual({
      url: "http://127.0.0.1:4567/secrets/add-blank",
      body: { folder: "/proj", names: ["GITHUB_TOKEN", "STRIPE_SECRET_KEY"], environment: "development", hint: "Stripe dashboard → Developers → API keys" },
    });
    expect([r.isError, said(r)]).toEqual([
      false,
      "STRIPE_SECRET_KEY is a blank in the aimhuge/weft vault (development) now; the user fills it in from 🔐. Carry on with what doesn't need it, and check mcp__secrets__list before you use it. GITHUB_TOKEN already has a value there.",
    ]);

    // No names were new blanks.
    fetchMock.mockReset();
    reply({ label: "aimhuge/weft", filled: ["A", "B"] });
    expect(said(await run("add_blank", { names: ["A", "B"], environment: "production", project: "/other" }))).toBe("A, B already have values there.");
    expect(sent().body).toEqual({ folder: "/other", names: ["A", "B"], environment: "production", hint: undefined });
  });

  it("pushes a vault value to Vercel without the value, production by default", async () => {
    reply({ pushed: true, project: "weft", label: "aimhuge/weft" });
    const r = await run("push_to_vercel", { name: "SUPABASE_SECRET_KEY" });
    expect(sent()).toEqual({ url: "http://127.0.0.1:4567/vercel/env-push", body: { folder: "/proj", name: "SUPABASE_SECRET_KEY", environment: "production" } });
    expect([r.isError, said(r)]).toEqual([false, "Pushed SUPABASE_SECRET_KEY (production) from the aimhuge/weft vault to Vercel project weft. It takes effect on the next deploy."]);

    fetchMock.mockReset();
    reply({ pushed: true });
    expect(said(await run("push_to_vercel", { name: "K", environment: "preview", project: "/other" }))).toBe("Pushed K (preview) from the this vault to Vercel project the linked project. It takes effect on the next deploy.");
    expect(sent().body).toEqual({ folder: "/other", name: "K", environment: "preview" });
  });

  it("reports a no and a missing value", async () => {
    reply({ denied: true, label: "aimhuge/weft" });
    const no = await run("push_to_vercel", { name: "K" });
    expect([no.isError, said(no)]).toEqual([true, "The user didn't approve pushing K. Ask before trying again."]);
    reply({ missing: true, label: "aimhuge/weft" });
    reply({ opened: true });
    const missing = await run("push_to_vercel", { name: "K" });
    expect(missing.isError).toBe(true);
    expect(said(missing)).toContain("K");
  });

  describe("set_value", () => {
    const VALUE = "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0";
    // Nothing the thread reads back may hold the value it passed in.
    const clean = (r: Result) => expect(JSON.stringify(r)).not.toContain(VALUE);

    it("sends the value to main and confirms by name only", async () => {
      reply({ ok: true, label: "aimhuge/weft" });
      const r = await run("set_value", { name: "PUKU_TRIAL_SIGNING_SECRET", value: VALUE, environment: "production" });
      expect(sent()).toEqual({
        url: "http://127.0.0.1:4567/secrets/set",
        body: { folder: "/proj", name: "PUKU_TRIAL_SIGNING_SECRET", value: VALUE, environment: "production" },
      });
      expect(r).toEqual({ content: [{ type: "text", text: "Set PUKU_TRIAL_SIGNING_SECRET in the aimhuge/weft vault (production)." }], isError: false });
      clean(r);

      fetchMock.mockReset();
      reply({ ok: true });
      expect(said(await run("set_value", { name: "K", value: VALUE, project: "/other" }))).toBe("Set K in the this vault (development).");
      expect(sent().body).toEqual({ folder: "/other", name: "K", value: VALUE, environment: "development" });
    });

    it("refuses a name that isn't a blank yet, a filled one, a no and an error, never echoing the value", async () => {
      reply({ missing: true, label: "aimhuge/weft" });
      const missing = await run("set_value", { name: "PUKU_TRIAL_SIGNING_SECRET", value: VALUE });
      expect([missing.isError, said(missing)]).toEqual([true, "PUKU_TRIAL_SIGNING_SECRET is not in the vault. Call add_blank first."]);
      // Unlike fill_field, a missing name doesn't open the Add form: the thread adds the blank itself.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      reply({ filled: true, label: "aimhuge/weft" });
      const filled = await run("set_value", { name: "K", value: VALUE });
      expect([filled.isError, said(filled)]).toEqual([true, "K already has a value in the aimhuge/weft vault (development); set_value only fills blanks. Ask the user to replace it in 🔐 if it should change."]);
      reply({ denied: true, label: "aimhuge/weft" });
      const no = await run("set_value", { name: "K", value: VALUE });
      expect([no.isError, said(no)]).toEqual([true, "The user didn't approve setting K. Ask before trying again."]);
      reply({ error: "The secrets vault isn't ready yet." }, false);
      const err = await run("set_value", { name: "K", value: VALUE });
      expect(said(err)).toBe("The secrets vault isn't ready yet.");
      for (const r of [missing, filled, no, err]) clean(r);
    });
  });
});
