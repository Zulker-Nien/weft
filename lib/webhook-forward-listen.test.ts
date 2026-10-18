import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredDelivery } from "./webhook-forward";

// The local half of the webhook relay, listening: the Realtime channel on webhook_deliveries, the drain of what
// arrived while Weft was closed, and following sign-in. The account's Supabase client and fetch are fakes; the registry
// (lib/webhooks.ts) is real, in a temp WEFT_DATA.

type Row = Record<string, unknown>;

const fake = await vi.hoisted(async () => {
  const f = (await import("./webhook-forward.harness")).fakeAccount();
  const dir = `${process.env.TMPDIR ?? "/tmp"}/weft-webhook-forward-${process.pid}-b`;
  process.env.WEFT_DATA = dir;
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

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("listening", () => {
  beforeEach(() => {
    reg.setRelay(hookId, { relayId: "r-1", url: "u" });
  });

  it("reads back the row a Realtime event names and forwards it", async () => {
    fake.state.deliveries = [delivery({ id: 5 })];
    await fwd.refreshWebhookRelay();
    fake.state.onChange?.({ new: { id: 5 } });
    fake.state.onChange?.({ new: {} });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fake.state.deliveries).toEqual([]);
  });

  it("ignores an event whose row is already gone, and logs a read error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await fwd.forwardById(9);
    expect(fetchMock).not.toHaveBeenCalled();
    fake.state.error = { message: "offline" };
    await fwd.forwardById(9);
    expect(warn).toHaveBeenCalledWith("Webhook delivery 9: offline");
  });

  it("forwards a row once even when the drain and an event meet it together", async () => {
    fake.state.deliveries = [delivery({ id: 5 })];
    let release: () => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(new Response("ok")))));
    const first = fwd.forwardById(5);
    await settle();
    await fwd.forwardById(5);
    release();
    await first;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("drains what's waiting, oldest first and less than a day old, each time the channel joins", async () => {
    fake.state.deliveries = [delivery({ id: 2, path: "/b" }), delivery({ id: 1, path: "/a" })];
    await fwd.refreshWebhookRelay();
    fake.state.onStatus?.("CHANNEL_ERROR");
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    fake.state.onStatus?.("SUBSCRIBED");
    await settle();
    await settle();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["http://localhost:3000/api/stripe/webhook/a", "http://localhost:3000/api/stripe/webhook/b"]);
    expect(fake.state.deliveries).toEqual([]);
    expect(Date.now() - Date.parse(fake.state.gte[0] ?? "")).toBeGreaterThan(23.9 * 3600_000);
    expect(Date.now() - Date.parse(fake.state.gte[0] ?? "")).toBeLessThan(24.1 * 3600_000);
  });

  it("logs a drain that can't read the table", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fake.state.error = { message: "offline" };
    await fwd.drainDeliveries();
    expect(warn).toHaveBeenCalledWith("Webhook deliveries: offline");
  });

  it("opens one channel per account, and none without a relay or a sign-in", async () => {
    await fwd.refreshWebhookRelay();
    await fwd.refreshWebhookRelay();
    expect(fake.state.channels).toHaveLength(1);
    reg.setRelay(hookId);
    await fwd.refreshWebhookRelay();
    expect(fake.state.removed).toBe(1);
    reg.setRelay(hookId, { relayId: "r-1", url: "u" });
    fake.state.uid = null;
    await fwd.refreshWebhookRelay();
    expect(fake.state.channels).toHaveLength(1);
  });

  it("follows sign-in and sign-out once started", async () => {
    vi.useFakeTimers();
    fwd.startWebhookRelay();
    fwd.startWebhookRelay();
    fake.state.onAuth?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.state.channels).toHaveLength(1);
    fake.state.uid = "u2";
    fake.state.onAuth?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.state.channels).toHaveLength(2);
    expect(fake.state.removed).toBe(1);
    fake.state.uid = null;
    fake.state.onAuth?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.state.removed).toBe(2);
  });

  it("logs a refresh that fails, and starts quietly with accounts off", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(reg, "listWebhooks").mockImplementation(() => {
      throw new Error("disk");
    });
    await fwd.refreshWebhookRelay();
    expect(warn).toHaveBeenCalledWith("Webhook relay: disk");
    fake.state.throwClient = true;
    expect(() => fwd.startWebhookRelay()).not.toThrow();
  });
});
