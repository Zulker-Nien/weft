import { beforeEach, describe, expect, it, vi } from "vitest";

// The local /api/account/team route: localhost guard, then forwardTeam. The sibling test
// app/api/account/billing/route.test.ts is the closest pattern; forwardTeam is mocked so the
// assertions are about the route's own choices (URL encoding, body pass-through, guard).

vi.mock("next/server", () => ({ connection: async () => {} }));
const { forwardTeam } = vi.hoisted(() => ({ forwardTeam: vi.fn() }));
vi.mock("@/lib/team-remote", () => ({ forwardTeam }));

// The Supabase client is only called to get the access token; we don't care which one the test
// passes, only that the route reaches forwardTeam with it.
const { accountClient } = vi.hoisted(() => ({ accountClient: vi.fn() }));
vi.mock("@/lib/account", () => ({ accountClient }));
const { forgetSyncOrg } = vi.hoisted(() => ({ forgetSyncOrg: vi.fn() }));
vi.mock("@/lib/cloud-sync", () => ({ forgetSyncOrg }));

const route = await import("./route");

const session = { data: { session: { access_token: "tk" } } };

function get(query = "", headers: Record<string, string> = { host: "127.0.0.1:3457" }) {
  return route.GET(new Request(`http://127.0.0.1:3457/api/account/team${query}`, { method: "GET", headers }));
}

function post(body: unknown, headers: Record<string, string> = { host: "127.0.0.1:3457", "x-weft-token": "1" }) {
  return route.POST(
    new Request("http://127.0.0.1:3457/api/account/team", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  accountClient.mockReturnValue({ auth: { getSession: () => Promise.resolve(session) } });
});

describe("GET /api/account/team", () => {
  it("refuses other hosts", async () => {
    const res = await get("", { host: "evil.com" });
    expect(res.status).toBe(403);
    expect(forwardTeam).not.toHaveBeenCalled();
  });

  it("doesn't need x-weft-token on a read", async () => {
    forwardTeam.mockResolvedValueOnce({ status: 200, json: { ok: true } });
    const res = await get();
    expect(res.status).toBe(200);
    expect(forwardTeam).toHaveBeenCalledWith("GET", "", undefined, expect.objectContaining({ session, env: process.env }));
  });

  it("URL-encodes the org query when one is given", async () => {
    forwardTeam.mockResolvedValueOnce({ status: 200, json: {} });
    await get("?org=acme%20co");
    expect(forwardTeam).toHaveBeenLastCalledWith("GET", "?org=acme%20co", undefined, expect.anything());
  });

  it("omits the query when no org was passed", async () => {
    forwardTeam.mockResolvedValueOnce({ status: 200, json: {} });
    await get();
    expect(forwardTeam).toHaveBeenLastCalledWith("GET", "", undefined, expect.anything());
  });

  it("passes the upstream status and JSON through", async () => {
    forwardTeam.mockResolvedValueOnce({ status: 404, json: { error: "not-found" } });
    const res = await get("?org=ghost");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not-found" });
  });

  it("is 400 with the message when the upstream throws", async () => {
    accountClient.mockReturnValueOnce({ auth: { getSession: () => Promise.reject(new Error("disk")) } });
    const res = await get();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "disk" });
  });
});

describe("POST /api/account/team", () => {
  it("refuses other hosts and writes without x-weft-token", async () => {
    const foreign = await route.POST(
      new Request("http://evil.com/api/account/team", { method: "POST", headers: { "x-weft-token": "1" }, body: "{}" }),
    );
    expect(foreign.status).toBe(403);
    const noHeader = await post({}, { host: "127.0.0.1:3457" });
    expect(noHeader.status).toBe(403);
    expect(forwardTeam).not.toHaveBeenCalled();
  });

  it("passes the JSON body through to forwardTeam untouched", async () => {
    forwardTeam.mockResolvedValueOnce({ status: 200, json: { ok: true } });
    const op = { org: "acme", action: "invite", email: "a@b.co", role: "member" };
    const res = await post(op);
    expect(res.status).toBe(200);
    expect(forwardTeam).toHaveBeenCalledWith("POST", "", op, expect.objectContaining({ session, env: process.env }));
  });

  it("passes the upstream status and JSON through on a non-2xx", async () => {
    forwardTeam.mockResolvedValueOnce({ status: 401, json: { error: "signed-out" } });
    const res = await post({});
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "signed-out" });
  });

  it("is 400 with the message when the body isn't JSON or the upstream throws", async () => {
    const bad = await route.POST(
      new Request("http://127.0.0.1:3457/api/account/team", { method: "POST", headers: { host: "127.0.0.1:3457", "x-weft-token": "1" }, body: "{" }),
    );
    expect(bad.status).toBe(400);
    accountClient.mockReturnValueOnce({ auth: { getSession: () => Promise.reject(new Error("offline")) } });
    const down = await post({});
    expect(down.status).toBe(400);
    expect(await down.json()).toEqual({ error: "offline" });
  });

  it("forgets this Mac's sync team after a delete went through, and only then", async () => {
    forwardTeam.mockResolvedValue({ status: 200, json: { ok: true } });
    await post({ org: "acme", action: "rename", name: "B" });
    expect(forgetSyncOrg).not.toHaveBeenCalled();
    forwardTeam.mockResolvedValueOnce({ status: 400, json: { error: "bad-request" } });
    await post({ org: "acme", action: "delete", confirm: "Acme" });
    expect(forgetSyncOrg).not.toHaveBeenCalled();
    await post({ org: "acme", action: "delete", confirm: "Acme" });
    expect(forgetSyncOrg).toHaveBeenCalledTimes(1);
  });
});
