import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// POST /api/folders: "Always allow" on an outside-folder prompt (lib/folder-guard.ts) puts the folder in settings.

const settings = vi.hoisted(() => ({ allowFolder: vi.fn() }));
vi.mock("@/lib/settings", () => settings);

const route = await import("./folders/route");
const WRITE = { host: "localhost:3457", "x-threadboard": "1", "content-type": "application/json" };
const post = (body: unknown, headers: Record<string, string> = WRITE) =>
  route.POST(new Request("http://localhost:3457/api/folders", { method: "POST", headers, body: JSON.stringify(body) }));

describe("POST /folders", () => {
  it("allows an existing folder for every card", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-folders-route-"));
    expect(await (await post({ folder: dir })).json()).toEqual({ ok: true });
    expect(settings.allowFolder).toHaveBeenCalledWith(dir);
  });

  it("turns away a relative path, a file and a missing folder", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "weft-folders-route-")), "a.txt");
    fs.writeFileSync(file, "x");
    for (const folder of ["Downloads", file, "/nonexistent/weft-folder", undefined]) {
      expect((await post({ folder })).status).toBe(400);
    }
    expect(settings.allowFolder).toHaveBeenCalledTimes(1);
  });

  it("needs the write header", async () => {
    expect((await post({ folder: "/tmp" }, { host: "localhost:3457", "content-type": "application/json" })).status).toBeGreaterThanOrEqual(400);
  });
});
