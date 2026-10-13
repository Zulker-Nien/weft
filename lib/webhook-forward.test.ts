import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredDelivery } from "./webhook-forward";

// The local half of the webhook relay: relay rows on your Weft account, the Realtime channel on webhook_deliveries,
// and the forward to a webhook's target. The account's Supabase client and fetch are fakes; the registry
// (lib/webhooks.ts) is real, in a temp THREADBOARD_DATA.

type Row = Record<string, unknown>;

const fake = await vi.hoisted(async () => {
  const f = (await import("./webhook-forward.harness")).fakeAccount();
  const dir = `${process.env.TMPDIR ?? "/tmp"}/weft-webhook-forward-${process.pid}-a`;
  process.env.THREADBOARD_DATA = dir;
  return { ...f, dir };
});

vi.mock("./account", () => ({
  accountClient: () => {
    if (fake.state.throwClient) throw new Error("Weft accounts aren't set up in this build yet.");
    return fake.client;
  },
}));
vi.mock("./github-hooks", () => ({ HOOK_URL: "https://relay.example/api/github/webhook" }));

const fwd = await import("./webhook-forward");
const reg = await import("./webhooks");

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
let hookId: string;

function delivery(over: Row = {}): StoredDelivery & Row {
  return {
    id: 1,
    relay_id: "r-1",
    user_id: "u1",
    method: "POST",
    path: "",
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=ab" },
    body: Buffer.from('{"id":"evt_1"}').toString("base64"),
    created_at: new Date().toISOString(),
    ...over,
  };
}

beforeEach(() => {
  fs.rmSync(fake.dir, { recursive: true, force: true });
  Object.assign(fake.state, { uid: "u1", relays: [], deliveries: [], error: null, deleteError: null, nextRelay: 1, onChange: null, onStatus: null, onAuth: null, channels: [], removed: 0, throwClient: false, gte: [] });
  delete (globalThis as Record<string, unknown>).__weftWebhookRelay;
  hookId = reg.addWebhook({ folder: "/a", name: "stripe", target: "/api/stripe/webhook" }).hook.id;
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => Promise.resolve(new Response("ok", { status: 200 })));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  fs.rmSync(fake.dir, { recursive: true, force: true });
});

describe("relayUrl", () => {
  it("is the deployed Weft's /api/hooks/<id>", () => {
    expect(fwd.RELAY_ORIGIN).toBe("https://relay.example");
    expect(fwd.relayUrl("abc")).toBe("https://relay.example/api/hooks/abc");
  });
});

describe("relaySignedIn", () => {
  it("is false signed out or with accounts off", async () => {
    expect(await fwd.relaySignedIn()).toBe(true);
    fake.state.uid = null;
    expect(await fwd.relaySignedIn()).toBe(false);
    fake.state.throwClient = true;
    expect(await fwd.relaySignedIn()).toBe(false);
  });
});

describe("createRelay", () => {
  it("makes the relay row, saves its URL on the webhook, and listens", async () => {
    const hook = await fwd.createRelay(hookId);
    const relayId = String(fake.state.relays[0]?.id);
    expect(fake.state.relays[0]).toMatchObject({ name: "stripe" });
    expect(hook).toMatchObject({ relayId, url: `https://relay.example/api/hooks/${relayId}` });
    expect(reg.getWebhook(hookId)?.relayId).toBe(relayId);
    expect(fake.state.channels).toEqual(["webhook-deliveries-u1"]);
  });

  it("returns the relay it already has", async () => {
    await fwd.createRelay(hookId);
    const again = await fwd.createRelay(hookId);
    expect(fake.state.relays).toHaveLength(1);
    expect(again.relayId).toBe(fake.state.relays[0]?.id);
    expect(fake.state.channels).toHaveLength(1);
  });

  it("needs a Weft sign-in, a webhook that exists, and a working database", async () => {
    fake.state.uid = null;
    await expect(fwd.createRelay(hookId)).rejects.toThrow("Sign in to your Weft account first: relay URLs come through it.");
    fake.state.uid = "u1";
    await expect(fwd.createRelay("nope")).rejects.toThrow("That webhook is gone.");
    fake.state.error = { message: "offline" };
    await expect(fwd.createRelay(hookId)).rejects.toThrow("offline");
    expect(reg.getWebhook(hookId)?.relayId).toBeUndefined();
  });
});

describe("removeRelay", () => {
  it("deletes the row, clears the URL, and stops listening with none left", async () => {
    await fwd.createRelay(hookId);
    const hook = await fwd.removeRelay(hookId);
    expect(fake.state.relays).toEqual([]);
    expect(hook.relayId).toBeUndefined();
    expect(hook.url).toBeUndefined();
    expect(fake.state.removed).toBe(1);
  });

  it("keeps listening while another webhook has a relay", async () => {
    const other = reg.addWebhook({ folder: "/a", name: "github", target: "/hook" }).hook.id;
    await fwd.createRelay(hookId);
    await fwd.createRelay(other);
    await fwd.removeRelay(hookId);
    expect(fake.state.relays).toHaveLength(1);
    expect(fake.state.removed).toBe(0);
  });

  it("still drops the local URL when signed out, and says if the row won't go", async () => {
    await fwd.createRelay(hookId);
    fake.state.uid = null;
    expect((await fwd.removeRelay(hookId)).relayId).toBeUndefined();
    expect(fake.state.relays).toHaveLength(1);

    fake.state.uid = "u1";
    reg.setRelay(hookId, { relayId: "x", url: "u" });
    fake.state.deleteError = { message: "refused" };
    await expect(fwd.removeRelay(hookId)).rejects.toThrow("refused");
    expect(reg.getWebhook(hookId)?.relayId).toBe("x");
    await expect(fwd.removeRelay("nope")).rejects.toThrow("That webhook is gone.");
  });

  it("is fine on a webhook that never had a relay", async () => {
    expect((await fwd.removeRelay(hookId)).id).toBe(hookId);
  });
});

describe("targetUrl", () => {
  it("adds the path and query that followed the relay id", () => {
    expect(fwd.targetUrl("http://localhost:3000/api/stripe/webhook", "")).toBe("http://localhost:3000/api/stripe/webhook");
    expect(fwd.targetUrl("http://localhost:3000/api/stripe/webhook", "?foo=1")).toBe("http://localhost:3000/api/stripe/webhook?foo=1");
    expect(fwd.targetUrl("http://localhost:3000/api/stripe/webhook", "/sub/x?foo=1")).toBe("http://localhost:3000/api/stripe/webhook/sub/x?foo=1");
    expect(fwd.targetUrl("http://localhost:3000/hook/", "/sub")).toBe("http://localhost:3000/hook/sub");
    expect(fwd.targetUrl("http://localhost:3000/hook?a=1", "?b=2")).toBe("http://localhost:3000/hook?a=1&b=2");
  });

  it("can't be moved off the target's host", () => {
    expect(fwd.targetUrl("http://localhost:3000/hook", "//evil.example/x")).toMatch(/^http:\/\/localhost:3000\//);
    expect(fwd.targetUrl("http://localhost:3000/hook", "@evil.example")).toBe("http://localhost:3000/hook");
  });
});

describe("forward", () => {
  beforeEach(() => {
    reg.setRelay(hookId, { relayId: "r-1", url: "https://relay.example/api/hooks/r-1" });
  });

  it("sends the request on byte for byte, records it, and deletes the row", async () => {
    fake.state.deliveries = [{ id: 1 }];
    await fwd.forward(delivery({ path: "?foo=1", headers: { "content-type": "application/json", "stripe-signature": "t=1", host: "x", "content-length": "9" } }));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://localhost:3000/api/stripe/webhook?foo=1");
    expect(init).toMatchObject({ method: "POST", headers: { "content-type": "application/json", "stripe-signature": "t=1" }, redirect: "manual" });
    expect(Buffer.from(init?.body as Uint8Array).toString()).toBe('{"id":"evt_1"}');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(fake.state.deliveries).toEqual([]);
    const hook = reg.getWebhook(hookId);
    expect(hook?.registered).toBe(true);
    expect(hook?.deliveries?.[0]).toMatchObject({ method: "POST", status: 200 });
    expect(hook?.deliveries?.[0]?.error).toBeUndefined();
  });

  it("sends a GET or an empty body with no body, and records the local route's own status", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response("bad", { status: 400 })));
    await fwd.forward(delivery({ method: "GET", body: "" }));
    await fwd.forward(delivery({ method: "DELETE", body: "" }));
    await fwd.forward(delivery({ method: "GET", body: "eA==" }));
    expect(fetchMock.mock.calls.map(([, init]) => init?.body)).toEqual([undefined, undefined, undefined]);
    expect(reg.getWebhook(hookId)?.deliveries?.map((d) => d.status)).toEqual([400, 400, 400]);
  });

  it("records an unreachable route as status 0 with why, and still deletes the row", async () => {
    fake.state.deliveries = [{ id: 1 }];
    fetchMock.mockRejectedValueOnce(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }));
    await fwd.forward(delivery());
    expect(reg.getWebhook(hookId)?.deliveries?.[0]).toMatchObject({ status: 0, error: "fetch failed (ECONNREFUSED)" });
    expect(fake.state.deliveries).toEqual([]);
  });

  it("says when the route took over 30 s, and when the error has no cause", async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    await fwd.forward(delivery());
    await fwd.forward(delivery());
    expect(reg.getWebhook(hookId)?.deliveries?.map((d) => d.error)).toEqual(["boom", "No answer in 30 s"]);
  });

  it("copes with a response that has no body to cancel", async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 204 })));
    await fwd.forward(delivery());
    expect(reg.getWebhook(hookId)?.deliveries?.[0]).toMatchObject({ status: 204 });
  });

  it("drops a delivery whose relay has no webhook here, with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fake.state.deliveries = [{ id: 7 }];
    await fwd.forward(delivery({ id: 7, relay_id: "someone-elses" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fake.state.deliveries).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no webhook here"));
  });

  it("warns, rather than throws, when Supabase won't delete the row", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fake.state.deleteError = { message: "refused" };
    await fwd.forward(delivery());
    expect(warn).toHaveBeenCalledWith("Webhook delivery 1: couldn't delete it from Supabase: refused");
  });
});
