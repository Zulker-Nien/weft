import { describe, expect, it, vi } from "vitest";
import { paneRoutes as rawRoutes, statusRoute } from "./pane-routes.cjs";

type Route = (body: Record<string, unknown>) => unknown;
type Api = { status: (folders: string[]) => unknown } | undefined;

function make(over: Record<string, unknown> = {}) {
  const sendMenu = vi.fn();
  const addBlanks = vi.fn(() => Promise.resolve());
  const vercel = { status: vi.fn((folders: string[]) => ({ folders, from: "vercel" })) };
  const deps = {
    dataDir: "/tmp/weft-data", app: {}, dialog: {}, shell: {}, window: () => null, board: () => null,
    sendMenu, updater: () => ({}), vault: () => ({ addBlanks }), vercelEnv: () => null,
    vercelApi: () => vercel, supabaseApi: () => undefined, ...over,
  };
  const routes = rawRoutes(deps) as unknown as Record<string, Route>;
  return { routes, sendMenu, addBlanks, vercel };
}

describe("paneRoutes", () => {
  it("serves every route main used to declare inline", () => {
    const keys = Object.keys(make().routes);
    for (const key of ["POST /secrets/ask-add", "POST /folder-access/ask", "POST /app/restart", "POST /webhooks/ask-add",
      "POST /vercel/status", "POST /supabase/status", "POST /vercel/env-push"]) expect(keys).toContain(key);
  });

  it("puts an asked-for key in as a development blank by default", async () => {
    const { routes, addBlanks } = make();
    await expect(routes["POST /secrets/ask-add"]!({ folder: "/p", name: "KEY" })).resolves.toEqual({ added: true });
    expect(addBlanks).toHaveBeenCalledWith("/p", ["KEY"], ["development"], { source: "a thread" });
  });

  it("still answers when the vault isn't set up or the add fails", async () => {
    await expect(make({ vault: () => undefined }).routes["POST /secrets/ask-add"]!({ folder: "/p", name: "K" })).resolves.toEqual({ added: true });
    const failing = { addBlanks: () => Promise.reject(new Error("locked")) };
    await expect(make({ vault: () => failing }).routes["POST /secrets/ask-add"]!({ folder: "/p", name: "K" })).resolves.toEqual({ added: true });
  });

  it("opens 🪝 on the board for a recorded webhook", () => {
    const { routes, sendMenu } = make();
    expect(routes["POST /webhooks/ask-add"]!({ folder: "/p", id: "stripe" })).toEqual({ ok: true });
    expect(sendMenu).toHaveBeenCalledWith("add-webhook", JSON.stringify({ folder: "/p", id: "stripe" }));
  });

  it("reads Vercel's status per folder, and an empty one while Supabase isn't set up", () => {
    const { routes, vercel } = make();
    expect(routes["POST /vercel/status"]!({ folders: ["/a", 7] })).toEqual({ folders: ["/a", "7"], from: "vercel" });
    expect(vercel.status).toHaveBeenCalledWith(["/a", "7"]);
    expect(routes["POST /supabase/status"]!({ folders: ["/a"] })).toEqual({ folders: [] });
  });
});

describe("statusRoute", () => {
  it("treats a missing folder list as none", () => {
    const api: Api = { status: vi.fn(() => ({ folders: ["x"] })) };
    expect(statusRoute(() => api)({} as { folders: string[] })).toEqual({ folders: ["x"] });
    expect(api.status).toHaveBeenCalledWith([]);
  });
});
