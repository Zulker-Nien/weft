// app/api/s/[id]/live/route.ts: GET /api/s/<id>/live. The route calls shareAccess, and for the
// "ok" branch hands off to buildShareLive. Both are mocked: shareAccess returns the verdict the
// test wants, buildShareLive returns a fixture.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { shareAccess, buildShareLive, serviceClient } = vi.hoisted(() => ({
  shareAccess: vi.fn(),
  buildShareLive: vi.fn(),
  serviceClient: vi.fn(),
}));

vi.mock("@/lib/share-access", () => ({ shareAccess }));
vi.mock("@/lib/share-live", () => ({ buildShareLive }));
vi.mock("@/lib/web-session", () => ({ serviceClient }));

async function load() {
  vi.resetModules();
  return import("./route");
}

beforeEach(() => {
  vi.clearAllMocks();
});

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/s/[id]/live", () => {
  it("returns 401 for login", async () => {
    shareAccess.mockResolvedValue({ kind: "login" });
    const { GET } = await load();
    const res = await GET(new Request("http://localhost/api/s/x/live"), ctx("x"));
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 403 for denied", async () => {
    shareAccess.mockResolvedValue({ kind: "denied" });
    const { GET } = await load();
    const res = await GET(new Request("http://localhost/api/s/x/live"), ctx("x"));
    expect(res.status).toBe(403);
  });

  it("returns 403 for gate", async () => {
    shareAccess.mockResolvedValue({ kind: "gate", mode: "email" });
    const { GET } = await load();
    const res = await GET(new Request("http://localhost/api/s/x/live"), ctx("x"));
    expect(res.status).toBe(403);
  });

  it("returns 404 for missing", async () => {
    shareAccess.mockResolvedValue({ kind: "missing" });
    const { GET } = await load();
    const res = await GET(new Request("http://localhost/api/s/x/live"), ctx("x"));
    expect(res.status).toBe(404);
  });

  it("returns 503 for unconfigured", async () => {
    shareAccess.mockResolvedValue({ kind: "unconfigured" });
    const { GET } = await load();
    const res = await GET(new Request("http://localhost/api/s/x/live"), ctx("x"));
    expect(res.status).toBe(503);
  });

  it("returns 404 when the ok verdict has no card row (deleted share)", async () => {
    shareAccess.mockResolvedValue({ kind: "ok", share: { share: { org_id: "o", card_id: "c", mode: "public" }, card: null } });
    const { GET } = await load();
    const res = await GET(new Request("http://localhost/api/s/x/live"), ctx("x"));
    expect(res.status).toBe(404);
  });

  it("returns 503 when the service client is missing on an ok verdict", async () => {
    shareAccess.mockResolvedValue({ kind: "ok", share: { share: { org_id: "o", card_id: "c", mode: "public" }, card: { card_id: "c", card: { id: "c" }, deleted: false, updated_at: "t" } } });
    serviceClient.mockReturnValue(null);
    const { GET } = await load();
    const res = await GET(new Request("http://localhost/api/s/x/live"), ctx("x"));
    expect(res.status).toBe(503);
  });

  it("returns the ShareLive JSON for ok with no cursors", async () => {
    shareAccess.mockResolvedValue({ kind: "ok", share: { share: { org_id: "o", card_id: "c", mode: "public" }, card: { card_id: "c", card: { id: "c" }, deleted: false, updated_at: "t" } } });
    serviceClient.mockReturnValue({});
    buildShareLive.mockResolvedValue({ card: { id: "c" }, items: [], hasOlder: false, pane: null, blobUrls: {} });
    const { GET } = await load();
    const res = await GET(new Request("http://localhost/api/s/x/live"), ctx("x"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ card: { id: "c" } });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const opts = buildShareLive.mock.calls[0]?.[0] as { after?: number; before?: number };
    expect(opts.after).toBeUndefined();
    expect(opts.before).toBeUndefined();
  });

  it("passes `after` and `before` cursors through", async () => {
    shareAccess.mockResolvedValue({ kind: "ok", share: { share: { org_id: "o", card_id: "c", mode: "public" }, card: { card_id: "c", card: { id: "c" }, deleted: false, updated_at: "t" } } });
    serviceClient.mockReturnValue({});
    buildShareLive.mockResolvedValue({ card: { id: "c" }, items: [], hasOlder: false, pane: null, blobUrls: {} });
    const { GET } = await load();
    await GET(new Request("http://localhost/api/s/x/live?after=5"), ctx("x"));
    expect((buildShareLive.mock.calls[0]?.[0] as { after?: number }).after).toBe(5);
    await GET(new Request("http://localhost/api/s/x/live?before=10"), ctx("x"));
    expect((buildShareLive.mock.calls[1]?.[0] as { before?: number }).before).toBe(10);
  });

  it("ignores a non-integer cursor (defaults to newest)", async () => {
    shareAccess.mockResolvedValue({ kind: "ok", share: { share: { org_id: "o", card_id: "c", mode: "public" }, card: { card_id: "c", card: { id: "c" }, deleted: false, updated_at: "t" } } });
    serviceClient.mockReturnValue({});
    buildShareLive.mockResolvedValue({ card: { id: "c" }, items: [], hasOlder: false, pane: null, blobUrls: {} });
    const { GET } = await load();
    await GET(new Request("http://localhost/api/s/x/live?after=notanint"), ctx("x"));
    expect((buildShareLive.mock.calls[0]?.[0] as { after?: number }).after).toBeUndefined();
  });
});