import { afterEach, describe, expect, it, vi } from "vitest";
import { handle, restStore, sameSignature, signature, type Hook, type HookStore } from "./github-relay";

// The webhook relay's checks (the hook, GitHub's HMAC signature, the event and the repo) and its Supabase store.

const HOOK: Hook = { id: "6f1c2a7e-0b8d-4c3e-9a51-2d7f00c1b9aa", user_id: "u1", repo: "acme/app", secret: "s3cret" };
const BODY = JSON.stringify({ action: "opened", issue: { number: 7 }, repository: { full_name: "Acme/App" } });

function store(hook: Hook | null = HOOK): HookStore & { save: ReturnType<typeof vi.fn> } {
  return { hook: vi.fn(() => Promise.resolve(hook)), save: vi.fn(() => Promise.resolve()) };
}

async function post(body = BODY, { event = "issues", hook = HOOK.id, sign = HOOK.secret, method = "POST" } = {}) {
  const headers: Record<string, string> = { "x-github-event": event, "x-github-delivery": "d-1" };
  if (sign) headers["x-hub-signature-256"] = await signature(sign, body);
  return new Request(`https://weft.example/api/github/webhook?hook=${hook}`, { method, headers, body: method === "POST" ? body : undefined });
}

describe("signature", () => {
  it("is GitHub's sha256= HMAC of the body", async () => {
    // GitHub's documented example: secret "It's a Secret to Everybody", body "Hello, World!".
    expect(await signature("It's a Secret to Everybody", "Hello, World!")).toBe("sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17");
  });

  it("compares in full", () => {
    expect(sameSignature("abc", "abc")).toBe(true);
    expect(sameSignature("abc", "abd")).toBe(false);
    expect(sameSignature("abc", "abcd")).toBe(false);
  });
});

describe("handle", () => {
  it("saves a signed issues event", async () => {
    const s = store();
    const res = await handle(await post(), s);
    expect(res.status).toBe(200);
    expect(s.save).toHaveBeenCalledWith({ hook_id: HOOK.id, user_id: "u1", repo: "acme/app", event: "issues", action: "opened", issue_number: 7, delivery: "d-1" });
  });

  it("saves what it can read of an odd payload", async () => {
    const s = store();
    await handle(await post(JSON.stringify({ repository: { full_name: "acme/app" } })), s);
    expect(s.save).toHaveBeenCalledWith(expect.objectContaining({ action: null, issue_number: null }));
  });

  it("answers GitHub's ping and drops other events", async () => {
    const s = store();
    expect((await handle(await post(BODY, { event: "ping" }), s)).status).toBe(200);
    expect((await handle(await post(BODY, { event: "push" }), s)).status).toBe(202);
    expect((await handle(await post(BODY, { event: "" }), s)).status).toBe(202);
    expect(s.save).not.toHaveBeenCalled();
  });

  it("refuses anything it can't trust", async () => {
    const s = store();
    expect((await handle(await post(BODY, { method: "GET" }), s)).status).toBe(405);
    expect((await handle(await post(BODY, { hook: "not-a-uuid" }), s)).status).toBe(404);
    expect((await handle(await post(BODY, { sign: "wrong" }), s)).status).toBe(401);
    expect((await handle(await post(BODY, { sign: "" }), s)).status).toBe(401);
    expect((await handle(await post("{nope"), s)).status).toBe(400);
    expect((await handle(await post(JSON.stringify({ repository: { full_name: "evil/app" } })), s)).status).toBe(400);
    expect((await handle(await post("{}"), s)).status).toBe(400);
    expect((await handle(await post(), store(null))).status).toBe(404);
    expect((await handle(new Request("https://weft.example/api/github/webhook", { method: "POST", body: BODY }), s)).status).toBe(404);
    expect(s.save).not.toHaveBeenCalled();
  });
});

describe("restStore", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(responses: Response[]) {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(responses.shift() ?? new Response("[]")));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("reads a hook with a new-style secret key", async () => {
    const fetch = stub([new Response(JSON.stringify([HOOK]))]);
    expect(await restStore("https://db.example", "sb_secret_x").hook(HOOK.id)).toEqual(HOOK);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`https://db.example/rest/v1/github_hooks?id=eq.${HOOK.id}&select=id,user_id,repo,secret`);
    expect(init?.headers).toEqual({ apikey: "sb_secret_x", "content-type": "application/json" });
  });

  it("finds no hook, and sends a legacy key as the bearer too", async () => {
    const fetch = stub([new Response("[]")]);
    expect(await restStore("https://db.example", "eyJlegacy").hook(HOOK.id)).toBeNull();
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "Bearer eyJlegacy" });
  });

  it("saves an event, takes a redelivery, and clears the hook's day-old events", async () => {
    const fetch = stub([new Response("", { status: 201 }), new Response(null, { status: 204 }), new Response("dup", { status: 409 }), new Response(null, { status: 204 })]);
    const store = restStore("https://db.example", "sb_secret_x", () => Date.UTC(2026, 9, 12));
    const event = { hook_id: HOOK.id, user_id: "u1", repo: "acme/app", event: "issues", action: "opened", issue_number: 7, delivery: "d-1" };
    await store.save(event);
    await store.save(event);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: JSON.stringify(event), headers: { prefer: "return=minimal" } });
    expect(fetch.mock.calls[1]?.[0]).toBe(`https://db.example/rest/v1/github_events?hook_id=eq.${HOOK.id}&created_at=lt.2026-10-11T00:00:00.000Z`);
    expect(fetch.mock.calls[1]?.[1]?.method).toBe("DELETE");
  });

  it("throws what Supabase said", async () => {
    stub([new Response("no table", { status: 404 }), new Response("down", { status: 500 })]);
    const store = restStore("https://db.example", "sb_secret_x");
    await expect(store.hook(HOOK.id)).rejects.toThrow("Supabase 404: no table");
    await expect(store.save({ hook_id: HOOK.id, user_id: "u1", repo: "acme/app", event: "issues", action: null, issue_number: null, delivery: null })).rejects.toThrow("Supabase 500: down");
  });
});
