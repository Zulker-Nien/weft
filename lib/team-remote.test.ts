import { describe, expect, it, vi } from "vitest";
import { forwardTeam } from "./team-remote";

// The forwarder's only job: take the access token, hit /api/teams, and pass the status and JSON back.
// No Supabase, no env, no real fetch — every dep is injected so the test stays honest about the contract.

const ENV = { WEFT_TEAMS_URL: "https://teams.test" };
const signedIn = { data: { session: { access_token: "tk" } } };
const signedOut = { data: { session: null } };

function fakeFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(() => Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), { status })));
}

describe("forwardTeam", () => {
  it("returns 401 signed-out when no access token is on the session", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const out = await forwardTeam("GET", "?org=acme", undefined, { session: signedOut, fetchFn, env: ENV });
    expect(out).toEqual({ status: 401, json: { error: "signed-out" } });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("uses WEFT_TEAMS_URL and forwards the bearer token on GET", async () => {
    const fetchFn = fakeFetch(200, { team: "ok" });
    const out = await forwardTeam("GET", "?org=acme", undefined, { session: signedIn, fetchFn, env: ENV });
    expect(out).toEqual({ status: 200, json: { team: "ok" } });
    expect(fetchFn).toHaveBeenCalledWith("https://teams.test/api/teams?org=acme", {
      method: "GET",
      headers: { authorization: "Bearer tk" },
    });
  });

  it("falls back to https://weft.zip when no env points elsewhere", async () => {
    const fetchFn = fakeFetch(200, {});
    await forwardTeam("GET", "", undefined, { session: signedIn, fetchFn, env: {} });
    expect(fetchFn).toHaveBeenCalledWith("https://weft.zip/api/teams", expect.objectContaining({ method: "GET" }));
  });

  it("strips a trailing slash from the URL so /api/teams isn't doubled", async () => {
    const fetchFn = fakeFetch(200, {});
    await forwardTeam("GET", "", undefined, { session: signedIn, fetchFn, env: { WEFT_TEAMS_URL: "https://teams.test/" } });
    expect(fetchFn).toHaveBeenCalledWith("https://teams.test/api/teams", expect.anything());
  });

  it("sends a JSON body and content-type on POST", async () => {
    const fetchFn = fakeFetch(200, { ok: true });
    const op = { org: "acme", action: "invite", email: "a@b.co", role: "member" as const };
    const out = await forwardTeam("POST", "", op, { session: signedIn, fetchFn, env: ENV });
    expect(out).toEqual({ status: 200, json: { ok: true } });
    expect(fetchFn).toHaveBeenCalledWith("https://teams.test/api/teams", {
      method: "POST",
      headers: { authorization: "Bearer tk", "content-type": "application/json" },
      body: JSON.stringify(op),
    });
  });

  it("sends POST without a body when none was given", async () => {
    const fetchFn = fakeFetch(200, {});
    await forwardTeam("POST", "", undefined, { session: signedIn, fetchFn, env: ENV });
    const init = (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1];
    expect(init).not.toHaveProperty("body");
    expect(init.headers).not.toHaveProperty("content-type");
  });

  it("returns 502 offline when fetch throws", async () => {
    const fetchFn = vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch;
    const out = await forwardTeam("GET", "", undefined, { session: signedIn, fetchFn, env: ENV });
    expect(out).toEqual({ status: 502, json: { error: "offline" } });
  });

  it("returns 502 bad-reply when the body isn't JSON", async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response("<html>oops</html>", { status: 502 }))) as unknown as typeof fetch;
    const out = await forwardTeam("GET", "", undefined, { session: signedIn, fetchFn, env: ENV });
    expect(out).toEqual({ status: 502, json: { error: "bad-reply" } });
  });

  it("passes the upstream status through unchanged", async () => {
    const fetchFn = fakeFetch(404, { error: "not-found" });
    const out = await forwardTeam("GET", "?org=ghost", undefined, { session: signedIn, fetchFn, env: ENV });
    expect(out).toEqual({ status: 404, json: { error: "not-found" } });
  });
});
