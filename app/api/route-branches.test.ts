import { beforeEach, describe, expect, it, vi } from "vitest";
import { COPILOT_ID } from "@/lib/types";

// The branches app/api/routes.test.ts doesn't reach: messages to the copilot, the login Terminal
// action, the new-thread page's folder, a clone with no name, and loosely-shaped settings bodies.

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/store", () => ({ getCard: vi.fn((id: string) => ({ id })) }));
vi.mock("@/lib/runner", () => ({ sendUserMessage: vi.fn(), retryAfterLogin: vi.fn() }));
vi.mock("@/lib/copilot", () => ({ sendToCopilot: vi.fn() }));
vi.mock("@/lib/login", () => ({
  authStatus: vi.fn(),
  loginRuns: vi.fn(() => [{ backend: "claude", state: "terminal" }]),
  startLogin: vi.fn(),
  openLoginInTerminal: vi.fn((backend: string) => ({ backend, state: "terminal" })),
  sendLoginInput: vi.fn(),
  cancelLogin: vi.fn(),
}));
vi.mock("@/lib/glance", () => ({ newThreadUrl: vi.fn((folder: string | null) => `file:///new?${folder}`) }));
vi.mock("@/lib/repos", () => ({
  cloneRepo: vi.fn((name: string) => (name ? Promise.resolve(`/dev/${name}`) : Promise.reject(new Error("Pick a repo.")))),
}));
vi.mock("@/lib/settings", () => ({
  listProjects: vi.fn(() => []),
  touchProject: vi.fn(),
  setThreadPrompt: vi.fn(),
  setKeepAliveMinutes: vi.fn(),
  setDefaultPermissionMode: vi.fn(),
  setAutomations: vi.fn(),
  settingsView: vi.fn(() => ({})),
}));

const runner = await import("@/lib/runner");
const copilot = await import("@/lib/copilot");
const login = await import("@/lib/login");
const repos = await import("@/lib/repos");
const settings = await import("@/lib/settings");
const messagesRoute = await import("./cards/[id]/messages/route");
const loginRoute = await import("./login/route");
const newThreadPageRoute = await import("./new-thread-page/route");
const cloneRoute = await import("./repos/clone/route");
const settingsRoute = await import("./settings/route");

const WRITE = { host: "localhost:3457", "x-threadboard": "1", "content-type": "application/json" };
const post = (url: string, body?: unknown, method = "POST") =>
  new Request(`http://localhost:3457/api${url}`, {
    method,
    headers: WRITE,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("POST /cards/:id/messages", () => {
  it("sends a message to the copilot through the copilot, not the runner", async () => {
    const res = await messagesRoute.POST(post(`/cards/${COPILOT_ID}/messages`, { text: " hi " }), { params: Promise.resolve({ id: COPILOT_ID }) });
    expect(res.status).toBe(200);
    expect(copilot.sendToCopilot).toHaveBeenCalledWith("hi");
    expect(runner.sendUserMessage).not.toHaveBeenCalled();
  });
});

describe("POST /login", () => {
  it("terminal opens the login in Terminal, which retries the CLI's cards when done", async () => {
    const res = await loginRoute.POST(post("/login", { backend: "claude", action: "terminal" }));
    expect(((await res.json()) as { login: unknown }).login).toEqual({ backend: "claude", state: "terminal" });
    vi.mocked(login.openLoginInTerminal).mock.calls[0]![1]!();
    expect(runner.retryAfterLogin).toHaveBeenCalledWith("claude");
  });

  it("input that isn't text is refused, and the current run comes back after real input", async () => {
    expect((await loginRoute.POST(post("/login", { backend: "claude", action: "input", text: 42 }))).status).toBe(400);
    expect(login.sendLoginInput).not.toHaveBeenCalled();
    const res = await loginRoute.POST(post("/login", { backend: "claude", action: "input", text: "code" }));
    expect(((await res.json()) as { login: unknown }).login).toEqual({ backend: "claude", state: "terminal" });
  });

  it("input for a CLI with no run returns no login", async () => {
    const res = await loginRoute.POST(post("/login", { backend: "puku", action: "input", text: "code" }));
    expect(((await res.json()) as { login: unknown }).login).toBeNull();
  });
});

describe("POST /new-thread-page", () => {
  it("passes a folder through, and treats anything else or a bad body as none", async () => {
    expect(await (await newThreadPageRoute.POST(post("/new-thread-page", { folder: "/dev/app" }))).json()).toEqual({ url: "file:///new?/dev/app" });
    expect(await (await newThreadPageRoute.POST(post("/new-thread-page", { folder: 3 }))).json()).toEqual({ url: "file:///new?null" });
    expect(await (await newThreadPageRoute.POST(post("/new-thread-page", "{"))).json()).toEqual({ url: "file:///new?null" });
  });
});

describe("POST /repos/clone", () => {
  it("a body without a name asks the clone for an empty one, which fails", async () => {
    const res = await cloneRoute.POST(post("/repos/clone", {}));
    expect(res.status).toBe(400);
    expect(repos.cloneRepo).toHaveBeenCalledWith("");
  });
});

describe("PATCH /settings", () => {
  const patch = (body: unknown) => settingsRoute.PATCH(post("/settings", body, "PATCH"));

  it("a null rule or one with no skill is refused", async () => {
    for (const automations of [[null], [{ on: "done" }]]) {
      expect((await patch({ automations })).status, JSON.stringify(automations)).toBe(400);
    }
    expect(settings.setAutomations).not.toHaveBeenCalled();
  });

  it("an empty body changes nothing", async () => {
    expect((await patch({})).status).toBe(200);
    expect(settings.setThreadPrompt).not.toHaveBeenCalled();
    expect(settings.setKeepAliveMinutes).not.toHaveBeenCalled();
    expect(settings.setDefaultPermissionMode).not.toHaveBeenCalled();
    expect(settings.setAutomations).not.toHaveBeenCalled();
  });
});
