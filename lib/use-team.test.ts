// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_EVENT } from "./auth/hooks";
import type { TeamSnapshot } from "./team-types";

// The hook talks to /api/account/team directly, not through the typed `api` client, because we need
// to discriminate on 401/404/502. Mocking global.fetch keeps the test honest about the headers and
// the URL the hook actually uses.

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const team: TeamSnapshot = {
  user: { id: "u1", email: "ada@b.co", name: "Ada", avatar: null },
  org: { id: "o1", slug: "acme", name: "Acme" },
  role: "owner",
  orgs: [{ id: "o1", slug: "acme", name: "Acme" }],
  canManage: true,
  members: [],
  pending: [],
  roleOptions: [],
  roleLabels: { owner: "Owner", admin: "Admin", member: "Member" },
};

const { clearTeamCache, prefetchTeam, useTeam, useTeamPrefetch } = await import("./use-team");

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

describe("prefetchTeam", () => {
  it("opens already loaded after a prefetch, then checks again in the background", async () => {
    prefetchTeam("acme");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    const { result } = renderHook(() => useTeam("acme"));
    expect(result.current.state).toMatchObject({ kind: "ok", team: { org: { slug: "acme" } } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("joins a prefetch still on its way instead of asking twice", async () => {
    prefetchTeam();
    const { result } = renderHook(() => useTeam());
    await waitFor(() => expect(result.current.state.kind).toBe("ok"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("doesn't fetch again once a team is loaded, but retries after a failed answer", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(502, { error: "offline" }));
    prefetchTeam();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    prefetchTeam();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    prefetchTeam();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("useTeamPrefetch loads the team for a signed-in user and forgets it on sign-out", async () => {
    const initialProps: { id?: string } = { id: "u1" };
    const { rerender } = renderHook(({ id }) => useTeamPrefetch(id), { initialProps });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    rerender({ id: undefined });
    const { result } = renderHook(() => useTeam());
    expect(result.current.state).toEqual({ kind: "loading" });
    await waitFor(() => expect(result.current.state.kind).toBe("ok"));
  });

  it("clearTeamCache forgets the loaded team", async () => {
    prefetchTeam();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    clearTeamCache();
    const { result } = renderHook(() => useTeam());
    expect(result.current.state).toEqual({ kind: "loading" });
    await waitFor(() => expect(result.current.state.kind).toBe("ok"));
  });
});

describe("useTeam", () => {
  it("loads the snapshot on mount", async () => {
    const { result } = renderHook(() => useTeam("acme"));
    expect(result.current.state).toEqual({ kind: "loading" });
    await waitFor(() => expect(result.current.state).toEqual({ kind: "ok", team }));
    expect(fetchMock).toHaveBeenCalledWith("/api/account/team?org=acme", { method: "GET" });
  });

  it("asks with no query when no org was given", async () => {
    const { result } = renderHook(() => useTeam());
    await waitFor(() => expect(result.current.state).toEqual({ kind: "ok", team }));
    expect(fetchMock).toHaveBeenCalledWith("/api/account/team", { method: "GET" });
  });

  it("URL-encodes the org slug in the query", async () => {
    const { result } = renderHook(() => useTeam("acme co/x"));
    await waitFor(() => expect(result.current.state.kind).toBe("ok"));
    expect(fetchMock).toHaveBeenCalledWith("/api/account/team?org=acme%20co%2Fx", { method: "GET" });
  });

  it("reloads when the org changes and shows loading in between", async () => {
    const { result, rerender } = renderHook(({ org }) => useTeam(org), { initialProps: { org: "acme" } });
    await waitFor(() => expect(result.current.state.kind).toBe("ok"));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ...team, org: { ...team.org, slug: "beta" } }));
    rerender({ org: "beta" });
    await waitFor(() => expect(result.current.state).toEqual({ kind: "loading" }));
    await waitFor(() => expect(result.current.state).toMatchObject({ kind: "ok", team: { org: { slug: "beta" } } }));
  });

  it("refresh() reloads the snapshot", async () => {
    const { result } = renderHook(() => useTeam("acme"));
    await waitFor(() => expect(result.current.state.kind).toBe("ok"));
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: "not-found" }));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.state).toEqual({ kind: "error", message: "No workspace found." }));
  });

  it("translates 401 to signed-out, 404 to 'No workspace found.', 502 to 'Couldn't reach weft.zip.'", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "signed-out" }));
    const a = renderHook(() => useTeam());
    await waitFor(() => expect(a.result.current.state).toEqual({ kind: "signed-out" }));
    cleanup();

    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: "not-found" }));
    const b = renderHook(() => useTeam("ghost"));
    await waitFor(() => expect(b.result.current.state).toEqual({ kind: "error", message: "No workspace found." }));
    cleanup();

    fetchMock.mockResolvedValueOnce(jsonResponse(502, { error: "offline" }));
    const c = renderHook(() => useTeam());
    await waitFor(() => expect(c.result.current.state).toEqual({ kind: "error", message: "Couldn't reach weft.zip." }));
  });

  it("translates a fetch throw to the offline error and shows a non-2xx error otherwise", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const offline = renderHook(() => useTeam());
    await waitFor(() => expect(offline.result.current.state).toEqual({ kind: "error", message: "Couldn't reach weft.zip." }));
    cleanup();

    fetchMock.mockResolvedValueOnce(jsonResponse(503, { error: "unconfigured" }));
    const bad = renderHook(() => useTeam());
    await waitFor(() => expect(bad.result.current.state).toEqual({ kind: "error", message: "unconfigured" }));
  });

  it("falls back to a status text when the body has no error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 500 }));
    const { result } = renderHook(() => useTeam());
    await waitFor(() => expect(result.current.state).toEqual({ kind: "error", message: "Weft's team API answered 500." }));
  });

  it("reloads when the board fires weft:account", async () => {
    const { result } = renderHook(() => useTeam("acme"));
    await waitFor(() => expect(result.current.state.kind).toBe("ok"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ...team, org: { ...team.org, slug: "acme" } }));
    act(() => {
      window.dispatchEvent(new Event(ACCOUNT_EVENT));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("stops listening for weft:account on unmount", async () => {
    const { result, unmount } = renderHook(() => useTeam("acme"));
    await waitFor(() => expect(result.current.state.kind).toBe("ok"));
    const calls = fetchMock.mock.calls.length;
    unmount();
    act(() => {
      window.dispatchEvent(new Event(ACCOUNT_EVENT));
    });
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  describe("actions", () => {
    it("POSTs with the loaded org's slug, refreshes after a 2xx, and returns the result", async () => {
      const { result } = renderHook(() => useTeam("acme"));
      await waitFor(() => expect(result.current.state.kind).toBe("ok"));
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, message: "Invited." }));
      const out = await act(() => result.current.actions.invite("a@b.co", "member"));
      expect(out).toEqual({ ok: true, message: "Invited." });
      const postCall = fetchMock.mock.calls.find(([, init]) => (init)?.method === "POST");
      expect(postCall).toEqual([
        "/api/account/team",
        expect.objectContaining({
          method: "POST",
          headers: { "content-type": "application/json", "x-weft-token": "1" },
          body: JSON.stringify({ org: "acme", action: "invite", email: "a@b.co", role: "member" }),
        }),
      ]);
      await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(2));
    });

    it("does the same shape for changeRole, remove, and revoke", async () => {
      const { result } = renderHook(() => useTeam("acme"));
      await waitFor(() => expect(result.current.state.kind).toBe("ok"));
      // POSTs get the action's result, and the refresh each one triggers gets the team again.
      fetchMock.mockImplementation((_url, init) =>
        Promise.resolve(init?.method === "POST" ? jsonResponse(200, { ok: true }) : jsonResponse(200, team)),
      );
      // Each action triggers a refresh, so the last call to fetch is always the refresh GET.
      // Find the POST in the recorded calls instead of asserting on the last call.
      const findPost = (action: string) =>
        fetchMock.mock.calls.find(([, init]) => {
          const i = init;
          if (i?.method !== "POST" || typeof i.body !== "string") return false;
          try { return (JSON.parse(i.body) as { action?: string }).action === action; } catch { return false; }
        });
      await act(() => result.current.actions.changeRole("u2", "admin"));
      expect(findPost("role")).toEqual([
        "/api/account/team",
        expect.objectContaining({ body: JSON.stringify({ org: "acme", action: "role", userId: "u2", role: "admin" }) }),
      ]);
      await act(() => result.current.actions.remove("u2"));
      expect(findPost("remove")).toEqual([
        "/api/account/team",
        expect.objectContaining({ body: JSON.stringify({ org: "acme", action: "remove", userId: "u2" }) }),
      ]);
      await act(() => result.current.actions.revoke("i1"));
      expect(findPost("revoke")).toEqual([
        "/api/account/team",
        expect.objectContaining({ body: JSON.stringify({ org: "acme", action: "revoke", inviteId: "i1" }) }),
      ]);
    });

    it("returns a friendly message and skips the network when no team is loaded", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "signed-out" }));
      const { result } = renderHook(() => useTeam());
      await waitFor(() => expect(result.current.state).toEqual({ kind: "signed-out" }));
      const calls = fetchMock.mock.calls.length;
      const out = await act(() => result.current.actions.invite("a@b.co", "member"));
      expect(out).toEqual({ ok: false, message: "Load a workspace first." });
      expect(fetchMock).toHaveBeenCalledTimes(calls);
    });

    it("maps action responses through 401, 404, 502 and a fetch throw", async () => {
      const { result } = renderHook(() => useTeam("acme"));
      await waitFor(() => expect(result.current.state.kind).toBe("ok"));

      fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "signed-out" }));
      expect(await act(() => result.current.actions.invite("a@b.co", "member"))).toEqual({ ok: false, message: "Signed out." });

      fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: "not-found" }));
      expect(await act(() => result.current.actions.remove("u2"))).toEqual({ ok: false, message: "No workspace found." });

      fetchMock.mockResolvedValueOnce(jsonResponse(502, { error: "offline" }));
      expect(await act(() => result.current.actions.revoke("i1"))).toEqual({ ok: false, message: "Couldn't reach weft.zip." });

      fetchMock.mockRejectedValueOnce(new Error("down"));
      expect(await act(() => result.current.actions.invite("a@b.co", "member"))).toEqual({ ok: false, message: "Couldn't reach weft.zip." });

      fetchMock.mockResolvedValueOnce(new Response("not json", { status: 500 }));
      expect(await act(() => result.current.actions.invite("a@b.co", "member"))).toEqual({ ok: false, message: "Team API answered 500." });
    });

    it("surfaces the upstream { ok: false, message } payload when the route forwards one", async () => {
      const { result } = renderHook(() => useTeam("acme"));
      await waitFor(() => expect(result.current.state.kind).toBe("ok"));
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: false, message: "You can't demote the only owner." }));
      expect(await act(() => result.current.actions.changeRole("u1", "member"))).toEqual({ ok: false, message: "You can't demote the only owner." });
    });

    it("doesn't refresh after a failed action", async () => {
      const { result } = renderHook(() => useTeam("acme"));
      await waitFor(() => expect(result.current.state.kind).toBe("ok"));
      const before = fetchMock.mock.calls.length;
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: false, message: "nope" }));
      await act(() => result.current.actions.invite("a@b.co", "member"));
      // One new call (the POST); the refresh fetch would be a second new call.
      expect(fetchMock.mock.calls.length).toBe(before + 1);
    });
  });
});
