// app/api/a/[id]/unlock/route.ts: the gate's submit for a mini app link. Wires loadAppShare
// (through serviceClient) into the unlockShare target, and recordVisit is insertAppShareVisit. The
// route is a thin wrapper; these tests check the wiring, not unlockShare's branches (those live
// in lib/share-unlock.test.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UnlockTarget } from "@/lib/share-unlock";

const { serviceClient, loadAppShare, insertAppShareVisit, unlockShare } = vi.hoisted(() => ({
  serviceClient: vi.fn(),
  loadAppShare: vi.fn(),
  insertAppShareVisit: vi.fn(),
  unlockShare: vi.fn<(req: Request, id: string, target: UnlockTarget) => Promise<Response>>(),
}));

vi.mock("@/lib/web-session", () => ({ serviceClient }));
vi.mock("@/lib/app-share-access", () => ({ loadAppShare, insertAppShareVisit }));
vi.mock("@/lib/share-unlock", () => ({ unlockShare }));

async function load() {
  vi.resetModules();
  return import("./route");
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default wiring: the service client is in place, loadAppShare resolves to a row, the unlock
  // helper returns 200. Tests that want a different shape override these per-case.
  serviceClient.mockReturnValue({ from: () => ({}) });
  loadAppShare.mockResolvedValue({ id: "s1", org_id: "o", app_id: "a1", mode: "public" });
  insertAppShareVisit.mockResolvedValue(undefined);
  unlockShare.mockResolvedValue(new Response("ok", { status: 200 }));
});

// The one call the route made to unlockShare.
function unlockCall() {
  const call = unlockShare.mock.calls[0];
  if (!call) throw new Error("unlockShare wasn't called");
  return call;
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function postReq(body: unknown): Request {
  return new Request(`http://localhost/api/a/x/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("POST /api/a/[id]/unlock wiring", () => {
  it("wires loadAppShare through serviceClient into unlockShare.target.load", async () => {
    const { POST } = await load();
    const res = await POST(postReq({ password: "x" }), ctx("s1"));
    expect(res.status).toBe(200);
    // unlockShare was called with a target whose load closes over serviceClient and loadAppShare.
    const target = unlockCall()[2];
    expect(typeof target.load).toBe("function");
    expect(typeof target.recordVisit).toBe("function");
    expect(target.recordVisit).toBe(insertAppShareVisit);
    // Triggering load(id) reads loadAppShare through the service client.
    const svc = serviceClient() as SupabaseClient;
    await target.load("s1");
    expect(loadAppShare).toHaveBeenCalledWith(svc, "s1");
  });

  it("returns null from target.load when the service client is missing", async () => {
    serviceClient.mockReturnValue(null);
    const { POST } = await load();
    await POST(postReq({ password: "x" }), ctx("s1"));
    const target = unlockCall()[2];
    expect(await target.load("s1")).toBeNull();
  });

  it("recordVisit delegates to insertAppShareVisit (so email visits land in cloud_app_share_visits)", async () => {
    const { POST } = await load();
    await POST(postReq({ email: "ada@example.com" }), ctx("s1"));
    const target = unlockCall()[2];
    await target.recordVisit(serviceClient() as SupabaseClient, { shareId: "s1", email: "ada@example.com" });
    expect(insertAppShareVisit).toHaveBeenCalledWith(expect.anything(), { shareId: "s1", email: "ada@example.com" });
  });

  it("passes the request, id, and target straight through to unlockShare", async () => {
    const { POST } = await load();
    const req = postReq({ password: "x" });
    await POST(req, ctx("s1"));
    const [passedReq, passedId, passedTarget] = unlockCall();
    expect(passedReq).toBe(req);
    expect(passedId).toBe("s1");
    expect(passedTarget).toBeDefined();
  });

  it("returns the unlockShare response unchanged", async () => {
    unlockShare.mockResolvedValue(new Response(JSON.stringify({ error: "nope" }), { status: 401, headers: { "content-type": "application/json" } }));
    const { POST } = await load();
    const res = await POST(postReq({ password: "x" }), ctx("s1"));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("nope");
  });
});
