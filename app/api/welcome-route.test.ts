import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Welcome } from "@/lib/welcome";
import type { WelcomePreview, WelcomeView } from "@/lib/welcome-client";

// GET/POST/PATCH /api/welcome: the welcome store, the preview calculator, and the session sync are
// mocked, so the route's guard, validation, and the shape of its answer are the things under test.

vi.mock("next/server", () => ({ connection: async () => {} }));

const welcomeMock = vi.hoisted(() => ({
  welcomeOrAdopt: vi.fn((): Welcome | null => null),
  saveWelcome: vi.fn(),
  setCountHistory: vi.fn(),
  importAll: vi.fn(),
}));
vi.mock("@/lib/welcome", () => welcomeMock);

const previewMock = vi.hoisted(() => ({
  welcomePreview: vi.fn(() => ({ projects: [], profile: { sessions: 0 } as never })),
}));
vi.mock("@/lib/welcome-preview", () => previewMock);

const importMock = vi.hoisted(() => ({
  sessionsToImport: vi.fn(() => Promise.resolve([] as { id: string }[])),
  syncSessions: vi.fn(() => Promise.resolve({ sessions: 0, added: 0, updated: 0 })),
}));
vi.mock("@/lib/import", () => importMock);

const githubMock = vi.hoisted(() => ({
  cachedGithubProfile: vi.fn(() => null),
  githubProfile: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("@/lib/github-profile", () => githubMock);

const route = await import("./welcome/route");

const GET_WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };
const write = (body?: unknown) => ({
  host: "localhost:3457",
  "x-weft-token": "1",
  "content-type": "application/json",
  ...(body === undefined ? {} : { "content-length": String(JSON.stringify(body).length) }),
});
const make = (method: "GET" | "POST" | "PATCH", body?: unknown, headers: Record<string, string> = GET_WRITE) =>
  new Request("http://localhost:3457/api/welcome", { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  welcomeMock.welcomeOrAdopt.mockReset().mockReturnValue(null);
  welcomeMock.saveWelcome.mockReset();
  welcomeMock.setCountHistory.mockReset();
  welcomeMock.importAll.mockReset();
  previewMock.welcomePreview.mockReset().mockReturnValue({ projects: [], profile: { sessions: 0 } as never });
  importMock.sessionsToImport.mockReset().mockResolvedValue([]);
  importMock.syncSessions.mockReset().mockResolvedValue({ sessions: 0, added: 0, updated: 0 });
  githubMock.cachedGithubProfile.mockReset().mockReturnValue(null);
  githubMock.githubProfile.mockReset().mockResolvedValue(null);
});

describe("GET /welcome", () => {
  it("returns the saved welcome when one is on file", async () => {
    const saved: Welcome = { at: 1, countHistory: true, fresh: false, skip: [] };
    welcomeMock.welcomeOrAdopt.mockReturnValueOnce(saved);
    const res = await route.GET(make("GET"));
    const body = (await res.json()) as { welcome: Welcome };
    expect(body).toEqual({ welcome: saved });
  });

  it("returns the preview when the welcome is undecided", async () => {
    const preview: WelcomePreview = { projects: [], profile: { sessions: 0 } as never, github: null };
    previewMock.welcomePreview.mockReturnValueOnce({ projects: [], profile: { sessions: 0 } as never });
    importMock.sessionsToImport.mockResolvedValueOnce([]);
    githubMock.githubProfile.mockResolvedValueOnce(null);
    const res = await route.GET(make("GET"));
    const body = (await res.json()) as WelcomeView;
    expect(body).toEqual({ welcome: null, preview: { ...preview, github: null } });
  });

  it("uses the cached GitHub profile when the live lookup fails", async () => {
    githubMock.githubProfile.mockRejectedValueOnce(new Error("gh down"));
    githubMock.cachedGithubProfile.mockReturnValueOnce({ login: "ada" } as never);
    const res = await route.GET(make("GET"));
    const body = (await res.json()) as WelcomeView;
    expect(body.preview?.github).toEqual({ login: "ada" });
  });

  it("refuses a non-local host", async () => {
    const res = await route.GET(new Request("http://evil.test/api/welcome", { method: "GET" }));
    expect(res.status).toBe(403);
  });

  it("returns 500 when the preview throws", async () => {
    previewMock.welcomePreview.mockImplementationOnce(() => {
      throw new Error("preview failed");
    });
    const res = await route.GET(make("GET"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "preview failed" });
  });
});

describe("POST /welcome", () => {
  it("saves the answer and fires a sync", async () => {
    const res = await route.POST(make("POST", { countHistory: true, fresh: false, skip: [] }));
    const body = (await res.json()) as { welcome: Welcome };
    expect(welcomeMock.saveWelcome).toHaveBeenCalledTimes(1);
    expect(body.welcome).toMatchObject({ countHistory: true, fresh: false, skip: [] });
    // syncSessions runs in the background — wait a microtask for the void promise to schedule.
    await new Promise((r) => setTimeout(r, 0));
    expect(importMock.syncSessions).toHaveBeenCalledTimes(1);
  });

  it("keeps only absolute paths in skip", async () => {
    await route.POST(make("POST", { countHistory: true, fresh: false, skip: ["/keep", "relative", 42, "/also"] }));
    const [next] = welcomeMock.saveWelcome.mock.calls[0]! as [Welcome];
    expect(next).toMatchObject({ skip: ["/keep", "/also"] });
  });

  it("rejects a missing countHistory or fresh with 400", async () => {
    const res1 = await route.POST(make("POST", { fresh: false, skip: [] }));
    expect(res1.status).toBe(400);
    const res2 = await route.POST(make("POST", { countHistory: true, skip: [] }));
    expect(res2.status).toBe(400);
    expect(welcomeMock.saveWelcome).not.toHaveBeenCalled();
  });

  it("rejects a body that isn't JSON", async () => {
    const res = await route.POST(new Request("http://localhost:3457/api/welcome", { method: "POST", headers: write(), body: "not json" }));
    expect(res.status).toBe(400);
  });

  it("refuses the call without the write header", async () => {
    const res = await route.POST(new Request("http://localhost:3457/api/welcome", { method: "POST", headers: { host: "localhost:3457", "content-type": "application/json" }, body: JSON.stringify({ countHistory: true, fresh: false, skip: [] }) }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(welcomeMock.saveWelcome).not.toHaveBeenCalled();
  });

  it("returns 500 when saving throws", async () => {
    welcomeMock.saveWelcome.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    const res = await route.POST(make("POST", { countHistory: true, fresh: false, skip: [] }));
    expect(res.status).toBe(500);
  });
});

describe("PATCH /welcome", () => {
  it("flips countHistory and returns the saved welcome", async () => {
    welcomeMock.welcomeOrAdopt.mockReturnValueOnce({ at: 1, countHistory: false, fresh: false, skip: [] });
    const res = await route.PATCH(make("PATCH", { countHistory: false }));
    expect(welcomeMock.setCountHistory).toHaveBeenCalledWith(false);
    expect(await res.json()).toEqual({ welcome: { at: 1, countHistory: false, fresh: false, skip: [] } });
  });

  it("calls importAll and fires a sync when importAll is true", async () => {
    welcomeMock.welcomeOrAdopt.mockReturnValueOnce(null);
    const res = await route.PATCH(make("PATCH", { importAll: true }));
    expect(welcomeMock.importAll).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(importMock.syncSessions).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ welcome: null });
  });

  it("answers 500 when saving the change throws", async () => {
    welcomeMock.setCountHistory.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    const res = await route.PATCH(make("PATCH", { countHistory: true }));
    expect(res.status).toBe(500);
  });

  it("logs a sync that fails after importAll without failing the request", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    importMock.syncSessions.mockRejectedValueOnce(new Error("disk"));
    const res = await route.PATCH(make("PATCH", { importAll: true }));
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(error).toHaveBeenCalledWith("Session sync failed:", expect.any(Error));
    error.mockRestore();
  });

  it("rejects a body that has neither flag with 400", async () => {
    const res = await route.PATCH(make("PATCH", {}));
    expect(res.status).toBe(400);
    expect(welcomeMock.setCountHistory).not.toHaveBeenCalled();
    expect(welcomeMock.importAll).not.toHaveBeenCalled();
  });

  it("ignores an empty body", async () => {
    const res = await route.PATCH(new Request("http://localhost:3457/api/welcome", { method: "PATCH", headers: write() }));
    expect(res.status).toBe(400);
  });

  it("refuses the call without the write header", async () => {
    const res = await route.PATCH(new Request("http://localhost:3457/api/welcome", { method: "PATCH", headers: { host: "localhost:3457", "content-type": "application/json" }, body: JSON.stringify({ countHistory: false }) }));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
