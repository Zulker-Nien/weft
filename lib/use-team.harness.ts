// The fetch stub, the team snapshot and the per-test setup lib/use-team*.test.ts share. The hook talks to
// /api/account/team directly, not through the typed `api` client, because it needs to discriminate on
// 401/404/502; mocking global.fetch keeps the tests honest about the headers and the URL it uses.
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import type { TeamSnapshot } from "./team-types";

export const fetchMock = vi.fn<typeof fetch>();

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const team: TeamSnapshot = {
  user: { id: "u1", email: "ada@b.co", name: "Ada", avatar: null },
  org: { id: "o1", slug: "acme", name: "Acme" },
  role: "owner",
  orgs: [{ id: "o1", slug: "acme", name: "Acme" }],
  canManage: true,
  members: [],
  pending: [],
  projects: [],
  roleOptions: [],
  roleLabels: { owner: "Owner", admin: "Admin", member: "Member" },
};

// A fresh cache and the fetch stub around every test in the calling file.
export function stubTeamFetch(clearTeamCache: () => void): void {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTeamCache();
    fetchMock.mockResolvedValue(jsonResponse(200, team));
    // happy-dom doesn't ship a default fetch; the tests install one for the duration of the suite.
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
}
