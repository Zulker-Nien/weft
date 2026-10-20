import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppBuildInfo, BuildResult } from "@/lib/app-build";

// POST /api/apps/build: the lib is loaded with await import() inside the handler so esbuild stays off the
// route's import path. The test mocks the lib the same way: a build function, and a readBuildInfo that
// returns the last record.

const okResult: BuildResult = { ok: true, at: 1, inputsHash: "h", hasCss: false };
const okInfo: AppBuildInfo = { ok: true, at: 1, inputsHash: "h" };

const lib = vi.hoisted(() => ({
  buildApp: vi.fn<() => Promise<BuildResult>>(() => Promise.resolve(okResult)),
  readBuildInfo: vi.fn<(slug: string) => AppBuildInfo | undefined>(() => okInfo),
  isAppFolderSlug: vi.fn((slug: string) => /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i.test(slug)),
}));
vi.mock("@/lib/app-build", () => lib);

const route = await import("./apps/build/route");
const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };
const post = (body: unknown, headers: Record<string, string> = WRITE) =>
  route.POST(new Request("http://localhost:3457/api/apps/build", { method: "POST", headers, body: JSON.stringify(body) }));

beforeEach(() => {
  lib.buildApp.mockReset().mockResolvedValue(okResult);
  lib.readBuildInfo.mockReset().mockReturnValue(okInfo);
});

describe("POST /api/apps/build", () => {
  it("rebuilds the app folder and returns the result and the build record", async () => {
    const res = await post({ slug: "demo" });
    expect(lib.buildApp).toHaveBeenCalledWith("demo");
    expect(lib.readBuildInfo).toHaveBeenCalledWith("demo");
    expect(await res.json()).toEqual({ result: okResult, info: okInfo });
  });

  it("returns the result and a fallback info when readBuildInfo finds no record", async () => {
    lib.readBuildInfo.mockReturnValueOnce(undefined);
    const failResult: BuildResult = { ok: false, at: 2, inputsHash: "x", error: "boom" };
    lib.buildApp.mockResolvedValueOnce(failResult);
    const res = await post({ slug: "demo" });
    expect(await res.json()).toEqual({ result: failResult, info: failResult });
  });

  it("returns a skipped result and a skipped info when buildApp reports skipped", async () => {
    const skippedInfo: AppBuildInfo = { ok: "skipped", at: 3, inputsHash: "z" };
    const skippedResult: BuildResult = { ok: "skipped", reason: "no App.tsx", at: 3, inputsHash: "z" };
    lib.readBuildInfo.mockReturnValueOnce(skippedInfo);
    lib.buildApp.mockResolvedValueOnce(skippedResult);
    const res = await post({ slug: "demo" });
    expect(await res.json()).toEqual({ result: skippedResult, info: skippedInfo });
  });

  it("trims whitespace from the slug", async () => {
    await post({ slug: "  demo  " });
    expect(lib.buildApp).toHaveBeenCalledWith("demo");
  });

  it("rejects a missing or non-string slug with 400", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ slug: "  " })).status).toBe(400);
    expect((await post({ slug: 42 })).status).toBe(400);
    expect(lib.buildApp).not.toHaveBeenCalled();
  });

  it("rejects a slug with a dot or slash with 400", async () => {
    for (const bad of ["../etc", "..", "foo/bar", "foo.bar", ".", "/"]) {
      const res = await post({ slug: bad });
      expect(res.status).toBe(400);
      const body = await res.json() as { error?: string };
      expect(body.error).toContain("Invalid app folder name");
    }
    expect(lib.buildApp).not.toHaveBeenCalled();
  });

  it("refuses a non-local host", async () => {
    const res = await post({ slug: "demo" }, { host: "evil.test", "x-weft-token": "1", "content-type": "application/json" });
    expect(res.status).toBe(403);
    expect(lib.buildApp).not.toHaveBeenCalled();
  });

  it("refuses the call without the write header", async () => {
    const res = await post({ slug: "demo" }, { host: "localhost:3457", "content-type": "application/json" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(lib.buildApp).not.toHaveBeenCalled();
  });

  it("turns a buildApp throw into a 400 with the message", async () => {
    lib.buildApp.mockRejectedValueOnce(new Error("App folder does not exist."));
    const res = await post({ slug: "missing" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "App folder does not exist." });
  });
});
