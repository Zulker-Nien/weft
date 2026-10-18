import { afterEach, describe, expect, it, vi } from "vitest";
import { handle, keptHeaders, MAX_BODY, restStore, type Relay, type RelayStore } from "./webhook-relay";

// The webhook relay's checks (the relay id, the size, which headers survive) and its Supabase store.

const RELAY: Relay = { id: "6f1c2a7e-0b8d-4c3e-9a51-2d7f00c1b9aa", user_id: "u1", name: "stripe" };

function store(relay: Relay | null = RELAY): RelayStore & { save: ReturnType<typeof vi.fn> } {
  return { relay: vi.fn(() => Promise.resolve(relay)), save: vi.fn(() => Promise.resolve()) };
}

const req = (method = "POST", body?: string, headers: Record<string, string> = {}) =>
  new Request(`https://weft.example/api/hooks/${RELAY.id}`, { method, headers, body: method === "GET" ? undefined : body });

describe("keptHeaders", () => {
  it("never passes the local API's write header from a stranger", () => {
    expect(keptHeaders(new Headers({ "x-weft-token": "1", "content-type": "text/plain" }))).toEqual({ "content-type": "text/plain" });
  });

  it("lowercases and drops hop-by-hop and Vercel's own headers", () => {
    const headers = new Headers({
      "Stripe-Signature": "t=1,v1=abc",
      "Content-Type": "application/json",
      Host: "weft.example",
      Connection: "close",
      "Content-Length": "2",
      "Transfer-Encoding": "chunked",
      "X-Forwarded-For": "1.2.3.4",
      "X-Forwarded-Proto": "https",
      "X-Vercel-Id": "iad1::x",
      "X-Real-IP": "1.2.3.4",
      Forwarded: "for=1.2.3.4",
    });
    expect(keptHeaders(headers)).toEqual({ "stripe-signature": "t=1,v1=abc", "content-type": "application/json" });
  });
});

describe("handle", () => {
  it("saves a POST with its headers and a base64 body", async () => {
    const s = store();
    const res = await handle(req("POST", '{"a":1}', { "content-type": "application/json", "x-forwarded-for": "9.9.9.9", "x-sig": "s" }), RELAY.id, "?foo=1", s);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Relayed");
    expect(s.relay).toHaveBeenCalledWith(RELAY.id);
    expect(s.save).toHaveBeenCalledWith({
      relay_id: RELAY.id,
      user_id: "u1",
      method: "POST",
      path: "?foo=1",
      headers: { "content-type": "application/json", "x-sig": "s" },
      body: Buffer.from('{"a":1}').toString("base64"),
    });
  });

  it("keeps the body's bytes exactly", async () => {
    const s = store();
    const bytes = new Uint8Array([0, 255, 128, 10, 13]);
    await handle(new Request(`https://weft.example/api/hooks/${RELAY.id}`, { method: "POST", body: bytes }), RELAY.id, "", s);
    const saved = s.save.mock.calls[0]?.[0] as { body: string };
    expect([...Buffer.from(saved.body, "base64")]).toEqual([...bytes]);
  });

  it("takes every method a provider might use, a GET challenge with no body too", async () => {
    const s = store();
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) expect((await handle(req(method, method === "GET" ? undefined : "x"), RELAY.id, "/sub", s)).status).toBe(200);
    expect(s.save).toHaveBeenCalledTimes(4);
    expect(s.save).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/sub", body: "" }));
  });

  it("refuses what it can't relay", async () => {
    const s = store();
    expect((await handle(req("OPTIONS"), RELAY.id, "", s)).status).toBe(405);
    expect((await handle(req("POST", "{}"), "not-a-uuid", "", s)).status).toBe(404);
    expect((await handle(req("POST", "{}"), RELAY.id, "", store(null))).status).toBe(404);
    expect(s.save).not.toHaveBeenCalled();
  });

  it("refuses a body over 1 MB, declared or actual", async () => {
    const s = store();
    expect((await handle(req("POST", "x", { "content-length": String(MAX_BODY + 1) }), RELAY.id, "", s)).status).toBe(413);
    expect((await handle(req("POST", "x".repeat(MAX_BODY + 1)), RELAY.id, "", s)).status).toBe(413);
    expect((await handle(req("POST", "x".repeat(MAX_BODY)), RELAY.id, "", s)).status).toBe(200);
    expect(s.save).toHaveBeenCalledTimes(1);
  });
});

describe("restStore", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(responses: Response[]) {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(responses.shift() ?? new Response("[]")));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  const delivery = { relay_id: RELAY.id, user_id: "u1", method: "POST", path: "", headers: { a: "b" }, body: "e30=" };

  it("reads a relay with a new-style secret key", async () => {
    const fetch = stub([new Response(JSON.stringify([RELAY]))]);
    expect(await restStore("https://db.example", "sb_secret_x").relay(RELAY.id)).toEqual(RELAY);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`https://db.example/rest/v1/webhook_relays?id=eq.${RELAY.id}&select=id,user_id,name`);
    expect(init?.headers).toEqual({ apikey: "sb_secret_x", "content-type": "application/json" });
  });

  it("finds no relay, and sends a legacy key as the bearer too", async () => {
    const fetch = stub([new Response("[]")]);
    expect(await restStore("https://db.example", "eyJlegacy").relay(RELAY.id)).toBeNull();
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "Bearer eyJlegacy" });
  });

  it("saves a delivery and clears the relay's day-old ones", async () => {
    const fetch = stub([new Response("", { status: 201 }), new Response(null, { status: 204 })]);
    await restStore("https://db.example", "sb_secret_x", () => Date.UTC(2026, 9, 13)).save(delivery);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://db.example/rest/v1/webhook_deliveries");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: JSON.stringify(delivery), headers: { prefer: "return=minimal" } });
    expect(fetch.mock.calls[1]?.[0]).toBe(`https://db.example/rest/v1/webhook_deliveries?relay_id=eq.${RELAY.id}&created_at=lt.2026-10-12T00:00:00.000Z`);
    expect(fetch.mock.calls[1]?.[1]?.method).toBe("DELETE");
  });

  it("uses the real clock by default, and throws what Supabase said", async () => {
    stub([new Response("no table", { status: 404 }), new Response("down", { status: 500 }), new Response("", { status: 201 }), new Response(null, { status: 204 })]);
    const s = restStore("https://db.example", "sb_secret_x");
    await expect(s.relay(RELAY.id)).rejects.toThrow("Supabase 404: no table");
    await expect(s.save(delivery)).rejects.toThrow("Supabase 500: down");
    await expect(s.save(delivery)).resolves.toBeUndefined();
  });
});
