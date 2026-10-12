import os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/github/issues: turns a folder's GitHub issue sync on (syncing it now), off, and lists it.
// lib/github-issues is mocked; the folder check is real, so it uses a folder that exists.

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/github-issues", () => ({
  syncIssues: vi.fn(() => Promise.resolve({ added: 2, updated: 1, archived: 0 })),
  enableIssueSync: vi.fn(),
  disableIssueSync: vi.fn(),
  issueSyncFolders: vi.fn(() => ["/dev/app"]),
  issueSyncStatus: vi.fn(() => ({ "/dev/app": { at: 1, repo: "acme/app" } })),
}));

const lib = await import("@/lib/github-issues");
const route = await import("./github/issues/route");

const URL = "http://localhost:3457/api/github/issues";
const READ = { host: "localhost:3457" };
const WRITE = { host: "localhost:3457", "x-threadboard": "1", "content-type": "application/json" };
const FOLDER = os.tmpdir();

const send = (method: string, body: unknown, headers: Record<string, string> = WRITE) =>
  new Request(URL, { method, headers, body: JSON.stringify(body) });

beforeEach(() => vi.clearAllMocks());

describe("GET /api/github/issues", () => {
  it("lists the folders that sync and their last sync", async () => {
    const res = await route.GET(new Request(URL, { headers: READ }));
    expect(await res.json()).toEqual({ folders: ["/dev/app"], status: { "/dev/app": { at: 1, repo: "acme/app" } } });
  });

  it("refuses other hosts", async () => {
    expect((await route.GET(new Request("http://evil.test/api/github/issues", { headers: { host: "evil.test" } }))).status).toBe(403);
  });
});

describe("POST /api/github/issues", () => {
  it("syncs the folder now, turns its sync on and returns the counts", async () => {
    const res = await route.POST(send("POST", { folder: FOLDER }));
    expect(await res.json()).toEqual({ folder: FOLDER, added: 2, updated: 1, archived: 0 });
    expect(lib.syncIssues).toHaveBeenCalledWith(FOLDER);
    expect(lib.enableIssueSync).toHaveBeenCalledWith(FOLDER);
  });

  it("leaves sync off when the sync fails, and says why", async () => {
    vi.mocked(lib.syncIssues).mockRejectedValueOnce(new Error("app has no GitHub remote, so it has no issues to import."));
    const res = await route.POST(send("POST", { folder: FOLDER }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch("no GitHub remote");
    expect(lib.enableIssueSync).not.toHaveBeenCalled();
  });

  it("refuses a missing folder and a write without the header", async () => {
    expect((await route.POST(send("POST", { folder: "/no/such/folder" }))).status).toBe(400);
    expect((await route.POST(send("POST", { folder: FOLDER }, READ))).status).toBe(403);
    expect(lib.syncIssues).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/github/issues", () => {
  it("turns the folder's sync off", async () => {
    const res = await route.DELETE(send("DELETE", { folder: "/dev/app" }));
    expect(await res.json()).toEqual({ folders: ["/dev/app"] });
    expect(lib.disableIssueSync).toHaveBeenCalledWith("/dev/app");
  });

  it("needs a folder and the header", async () => {
    expect((await route.DELETE(send("DELETE", {}))).status).toBe(400);
    expect((await route.DELETE(send("DELETE", { folder: "/dev/app" }, READ))).status).toBe(403);
    expect(lib.disableIssueSync).not.toHaveBeenCalled();
  });
});
