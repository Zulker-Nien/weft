import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The scene route against a temp assets folder holding one of the pictures.
let dir: string;
let serve: typeof import("./[id]/route");

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-scenes-"));
  fs.writeFileSync(path.join(dir, "backdrop-canyon.jpg"), "jpeg bytes");
  vi.stubEnv("WEFT_ASSETS_DIR", dir);
  vi.resetModules();
  serve = await import("./[id]/route");
});
afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

const get = (id: string, host = "localhost") =>
  serve.GET(new Request(`http://${host}/api/scenes/${id}`, { headers: { host } }), { params: Promise.resolve({ id }) });

describe("GET /api/scenes/[id]", () => {
  it("serves a scene's picture as a cached jpeg", async () => {
    const res = await get("canyon");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toMatch(/max-age/);
    expect(await res.text()).toBe("jpeg bytes");
  });

  it("404s an id that isn't a scene, so no other file can be named", async () => {
    expect((await get("..%2Fpackage.json")).status).toBe(404);
    expect((await get("dark")).status).toBe(404);
  });

  it("404s a listed scene whose picture is missing", async () => {
    const res = await get("neon-city");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Scene picture missing." });
  });

  it("refuses other hosts", async () => {
    expect((await get("canyon", "evil.example")).status).toBe(403);
  });
});
