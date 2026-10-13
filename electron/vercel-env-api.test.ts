import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createVercel, ENV_EVENTS } from "./vercel.cjs";

// The linked project's variables and the team webhook, against a fake api.vercel.com (the rest is vercel.test.ts).

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`w:${text}`),
  decryptString: (buf: Buffer) => buf.toString().slice(2),
};

const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

type Route = (url: URL) => { status?: number; body: unknown };

function fakeFetch(routes: Record<string, unknown>) {
  const calls: { url: URL; method: string; body: string | undefined }[] = [];
  const fetch = vi.fn((url: URL, init: { method: string; body?: string }) => {
    calls.push({ url, method: init.method, body: init.body });
    const route = routes[url.pathname];
    const answer = typeof route === "function" ? (route as Route)(url) : route === undefined ? { status: 404, body: { error: { message: "Not found" } } } : { body: route };
    const status = answer.status ?? 200;
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(answer.body) });
  });
  return { fetch, calls };
}

const API = { "/v2/user": { user: { username: "fotoflo" } } };

function make(routes: Record<string, unknown> = API) {
  const { fetch, calls } = fakeFetch(routes);
  const vercel = createVercel({ dataDir: tmp("weft-data-"), safeStorage, fetch: fetch as unknown as typeof globalThis.fetch, remote: () => Promise.resolve("") });
  return { vercel, calls };
}

describe("createVercel env and webhooks", () => {
  function linked(vercel: ReturnType<typeof make>["vercel"], orgId = "team_a") {
    const folder = tmp("weft-proj-");
    fs.mkdirSync(path.join(folder, ".vercel"));
    fs.writeFileSync(path.join(folder, ".vercel/project.json"), JSON.stringify({ projectId: "prj_1", orgId, projectName: "web" }));
    return vercel.setToken("tok").then(() => folder);
  }

  it("lists the linked project's variables with their ids and types, never values", async () => {
    const { vercel, calls } = make({
      ...API,
      "/v10/projects/prj_1/env": {
        envs: [
          { id: "e1", key: "A", target: ["production", "preview"], type: "plain", value: "leak" },
          { id: "e2", key: "B", target: "development", type: "sensitive" },
          { key: "C" },
        ],
      },
    });
    const folder = await linked(vercel);
    expect(await vercel.envList(folder)).toEqual({
      project: "web",
      envs: [
        { id: "e1", key: "A", targets: ["production", "preview"], type: "plain" },
        { id: "e2", key: "B", targets: ["development"], type: "sensitive" },
        { id: null, key: "C", targets: [], type: null },
      ],
    });
    expect(calls.at(-1)?.url.searchParams.get("teamId")).toBe("team_a");
    await expect(vercel.envList(tmp("weft-proj-"))).rejects.toThrow("isn't linked");
  });

  it("reads one variable's value when Vercel hands it back", async () => {
    const { vercel, calls } = make({
      ...API,
      "/v1/projects/prj_1/env/e1": { id: "e1", type: "plain", value: "hello" },
      "/v1/projects/prj_1/env/e%2F2": { type: "encrypted", value: "enc" },
      "/v1/projects/prj_1/env/e3": { type: "sensitive", value: "should-not-leak" },
      "/v1/projects/prj_1/env/e4": { type: "plain", value: "" },
      "/v1/projects/prj_1/env/e5": { type: "plain" },
      "/v1/projects/prj_1/env/e6": { type: "plain", value: 5 },
    });
    const folder = await linked(vercel);
    expect(await vercel.envValue(folder, "e1")).toBe("hello");
    expect(calls.at(-1)?.url.searchParams.get("teamId")).toBe("team_a");
    expect(await vercel.envValue(folder, "e3")).toBeNull();
    expect(await vercel.envValue(folder, "e4")).toBeNull();
    expect(await vercel.envValue(folder, "e5")).toBeNull();
    expect(await vercel.envValue(folder, "e6")).toBeNull();
    expect(await vercel.envValue(folder, "e/2")).toBe("enc");
  });

  it("won't read a value for an unlinked folder, and passes Vercel's error on", async () => {
    const { vercel } = make();
    await vercel.setToken("tok");
    await expect(vercel.envValue(tmp("weft-proj-"), "e1")).rejects.toThrow("isn't linked");
    const folder = await linked(vercel);
    await expect(vercel.envValue(folder, "missing")).rejects.toThrow("Not found");
  });

  it("makes a team webhook for the env events, and gives back its id and secret", async () => {
    const { vercel, calls } = make({ ...API, "/v1/webhooks": { id: "hook_1", secret: "shh", extra: 1 } });
    await vercel.setToken("tok");
    expect(await vercel.createWebhook("team_a", "https://weft.zip/api/vercel/webhook")).toEqual({ id: "hook_1", secret: "shh" });
    const post = calls.at(-1)!;
    expect(post.method).toBe("POST");
    expect(post.url.searchParams.get("teamId")).toBe("team_a");
    expect(JSON.parse(post.body ?? "{}")).toEqual({ url: "https://weft.zip/api/vercel/webhook", events: ENV_EVENTS });
    expect(ENV_EVENTS).toEqual(["project.env-variable.created", "project.env-variable.updated"]);
  });

  it("refuses a webhook outside a team before asking Vercel", async () => {
    const { vercel, calls } = make();
    await vercel.setToken("tok");
    const before = calls.length;
    await expect(vercel.createWebhook("u_1", "https://x.test")).rejects.toThrow("belong to a team");
    await expect(vercel.createWebhook("", "https://x.test")).rejects.toThrow("belong to a team");
    expect(calls.length).toBe(before);
  });

  it("takes a webhook off, treats one already gone as done, and rethrows anything else", async () => {
    let status = 200;
    const { vercel, calls } = make({ ...API, "/v1/webhooks/hook_1": () => ({ status, body: status === 500 ? { error: { message: "boom" } } : {} }) });
    await vercel.setToken("tok");
    expect(await vercel.deleteWebhook("team_a", "hook_1")).toEqual({ removed: true });
    expect(calls.at(-1)).toMatchObject({ method: "DELETE" });
    expect(calls.at(-1)?.url.searchParams.get("teamId")).toBe("team_a");
    status = 404;
    expect(await vercel.deleteWebhook("team_a", "hook_1")).toEqual({ removed: true });
    status = 500;
    await expect(vercel.deleteWebhook("team_a", "hook_1")).rejects.toThrow("boom");
  });
});
