import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { writeLink } from "./vercel-project.cjs";
import { createVercel } from "./vercel.cjs";

// The linked project's environment variables through Vercel's API: names out, one value in (electron/vercel.cjs).

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`w:${text}`),
  decryptString: (buf: Buffer) => buf.toString().slice(2),
};

const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

type Answer = (url: URL) => { body: unknown };

// A fake api.vercel.com for the paths these tests use; records each call.
function make(routes: Record<string, unknown>) {
  const calls: { url: URL; method: string; body: string | undefined }[] = [];
  const fetch = vi.fn((url: URL, init: { method: string; body?: string }) => {
    calls.push({ url, method: init.method, body: init.body });
    const route = routes[url.pathname];
    const body = typeof route === "function" ? (route as Answer)(url).body : route;
    return Promise.resolve({ ok: route !== undefined, status: route === undefined ? 404 : 200, json: () => Promise.resolve(body ?? {}) });
  });
  const vercel = createVercel({ dataDir: tmp("weft-data-"), safeStorage, fetch: fetch as unknown as typeof globalThis.fetch, remote: () => Promise.resolve(null) });
  return { vercel, calls };
}

const API = { "/v2/user": { user: { username: "fotoflo" } } };

describe("env", () => {
  it("lists the linked project's variables by name and pushes one, sensitive outside Development", async () => {
    const envs = { envs: [{ key: "A", target: ["production", "preview"], type: "sensitive" }, { key: "B", target: "development" }, { key: "C" }] };
    const { vercel, calls } = make({ ...API, "/v10/projects/prj_1/env": (url: URL) => ({ body: url.searchParams.get("upsert") ? { created: {} } : envs }) });
    await vercel.setToken("t");
    const folder = tmp("weft-proj-");
    await expect(vercel.envList(folder)).rejects.toThrow("isn't linked");
    await expect(vercel.envSet(folder, "A", "production", "v")).rejects.toThrow("isn't linked");
    writeLink(folder, "prj_1", "team_a", "web");
    expect(await vercel.envList(folder)).toEqual({
      project: "web",
      envs: [
        { key: "A", targets: ["production", "preview"], type: "sensitive" },
        { key: "B", targets: ["development"], type: null },
        { key: "C", targets: [], type: null },
      ],
    });
    expect(calls.at(-1)?.url.searchParams.get("teamId")).toBe("team_a");
    expect(await vercel.envSet(folder, "A", "production", "secret-value")).toEqual({ pushed: true, project: "web" });
    expect(calls.at(-1)).toMatchObject({ method: "POST", body: JSON.stringify({ key: "A", value: "secret-value", type: "sensitive", target: ["production"] }) });
    expect(calls.at(-1)?.url.searchParams.get("upsert")).toBe("true");
    await vercel.envSet(folder, "B", "development", "dev");
    expect(JSON.parse(calls.at(-1)?.body ?? "{}")).toMatchObject({ type: "encrypted", target: ["development"] });
  });

  it("names the project by id when the link has no name", async () => {
    const { vercel } = make({ ...API, "/v10/projects/prj_1/env": { created: {} } });
    await vercel.setToken("t");
    const folder = tmp("weft-proj-");
    fs.mkdirSync(path.join(folder, ".vercel"));
    fs.writeFileSync(path.join(folder, ".vercel", "project.json"), JSON.stringify({ projectId: "prj_1", orgId: "me" }));
    expect(await vercel.envList(folder)).toEqual({ project: "prj_1", envs: [] });
    expect(await vercel.envSet(folder, "A", "preview", "v")).toEqual({ pushed: true, project: "prj_1" });
  });
});
