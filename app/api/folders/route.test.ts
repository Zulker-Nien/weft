import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// The trusted-folder route (app/api/folders/route.ts): "Always allow" on a folder-guard prompt, and the
// revoke Settings → General's trusted-folders row. Its own file because app/api/routes.test.ts sits on its
// line ratchet and adding to it means taking code out of there, not adding a cap.
//
// The handler reads one thing off the filesystem (is it a folder) and two functions off the settings module.
vi.mock("@/lib/settings", () => ({ allowFolder: vi.fn(), unallowFolder: vi.fn() }));

const settings = await import("@/lib/settings");
const foldersRoute = await import("./route");

const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };

function req(method: string, body: unknown) {
  return new Request("http://localhost:3457/api/folders", {
    method,
    headers: WRITE,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const error = async (res: Response) => ((await res.json()) as { error: string }).error;

describe("POST /folders", () => {
  it("grants a folder that's really there", async () => {
    const real = os.tmpdir();
    expect(await (await foldersRoute.POST(req("POST", { folder: real }))).json()).toEqual({ ok: true });
    expect(settings.allowFolder).toHaveBeenLastCalledWith(real);
  });

  it("refuses a path that isn't absolute", async () => {
    const res = await foldersRoute.POST(req("POST", { folder: "Downloads" }));
    expect(res.status).toBe(400);
    expect(await error(res)).toBe("folder must be an absolute path.");
  });

  it("refuses something that isn't a folder", async () => {
    const res = await foldersRoute.POST(req("POST", { folder: path.join(os.tmpdir(), "no-such-dir-xyz") }));
    expect(res.status).toBe(400);
    expect(await error(res)).toMatch(/not a folder|ENOENT|cannot find/i);
  });
});

// The revoke from Settings → General. It takes the path as sent, without checking the folder still exists:
// a folder that's gone can't be left in the list taking up space, and pressing Remove twice has to be fine.
describe("DELETE /folders", () => {
  it("takes a folder back out without needing it to still exist", async () => {
    const gone = path.join(os.tmpdir(), "already-deleted");
    expect(await (await foldersRoute.DELETE(req("DELETE", { folder: gone }))).json()).toEqual({ ok: true });
    expect(settings.unallowFolder).toHaveBeenLastCalledWith(gone);
  });

  it("is quiet on a folder that was never allowed", async () => {
    expect((await foldersRoute.DELETE(req("DELETE", { folder: "/Users/me/Never" }))).status).toBe(200);
  });

  it("answers 400 with no folder in the body, or a body that isn't JSON", async () => {
    expect(await error(await foldersRoute.DELETE(req("DELETE", {})))).toBe("folder must be a path.");
    expect((await foldersRoute.DELETE(req("DELETE", "{"))).status).toBe(400);
  });
});

describe("both verbs", () => {
  it("need the write token", async () => {
    const bare = (method: string, folder: unknown) =>
      new Request("http://localhost:3457/api/folders", {
        method,
        headers: { host: "localhost:3457", "content-type": "application/json" },
        body: JSON.stringify({ folder }),
      });
    vi.mocked(settings.allowFolder).mockClear();
    vi.mocked(settings.unallowFolder).mockClear();

    expect((await foldersRoute.POST(bare("POST", os.tmpdir()))).status).toBe(403);
    expect(settings.allowFolder).not.toHaveBeenCalled();
    expect((await foldersRoute.DELETE(bare("DELETE", os.tmpdir()))).status).toBe(403);
    expect(settings.unallowFolder).not.toHaveBeenCalled();
  });
});