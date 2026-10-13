import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENTS, handle, restStore, signature, toEvent, type VercelHook, type VercelHookStore } from "./vercel-relay";

// The Vercel webhook relay's checks (the hook, Vercel's HMAC-SHA1 signature, the event and the team) and its Supabase store.

const HOOK: VercelHook = { id: "6f1c2a7e-0b8d-4c3e-9a51-2d7f00c1b9aa", user_id: "u1", team_id: "team_abc", secret: "s3cret" };
const BODY = JSON.stringify({ id: "evt_1", type: "project.env-variable.created", payload: { team: { id: "team_abc" }, projectId: "prj_1" } });

function store(hook: VercelHook | null = HOOK): VercelHookStore & { save: ReturnType<typeof vi.fn> } {
  return { hook: vi.fn(() => Promise.resolve(hook)), save: vi.fn(() => Promise.resolve()) };
}

async function post(body = BODY, { hook = HOOK.id, sign = HOOK.secret, method = "POST" } = {}) {
  const headers: Record<string, string> = {};
  if (sign) headers["x-vercel-signature"] = await signature(sign, body);
  return new Request(`https://weft.example/api/vercel/webhook?hook=${hook}`, { method, headers, body: method === "POST" ? body : undefined });
}

describe("signature", () => {
  it("is the bare hex HMAC-SHA1 of the body", async () => {
    const expected = createHmac("sha1", "s3cret").update(BODY).digest("hex");
    expect(await signature("s3cret", BODY)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{40}$/);
  });

  it("changes with the secret and the body", async () => {
    expect(await signature("other", BODY)).not.toBe(await signature("s3cret", BODY));
    expect(await signature("s3cret", "{}")).not.toBe(await signature("s3cret", BODY));
  });
});

describe("toEvent", () => {
  it("becomes the vercel_events row", () => {
    expect(toEvent(HOOK, BODY)).toEqual({ hook_id: HOOK.id, user_id: "u1", team_id: "team_abc", project_id: "prj_1", type: "project.env-variable.created", event_id: "evt_1" });
  });

  it("takes an updated event, an event with no team, and one with no id", () => {
    const body = JSON.stringify({ type: "project.env-variable.updated", payload: { projectId: "prj_2" } });
    expect(toEvent(HOOK, body)).toMatchObject({ project_id: "prj_2", type: "project.env-variable.updated", event_id: null });
    expect(toEvent(HOOK, JSON.stringify({ type: "project.env-variable.created", payload: { team: null, projectId: "prj_2" } }))).toMatchObject({ project_id: "prj_2" });
  });

  it("names why it can't", () => {
    expect(toEvent(HOOK, "{nope")).toBe("Body isn't JSON");
    expect(toEvent(HOOK, JSON.stringify({ type: "deployment.created" }))).toBe("Ignored deployment.created");
    expect(toEvent(HOOK, "{}")).toBe("Ignored event");
    expect(toEvent(HOOK, JSON.stringify({ type: 5 }))).toBe("Ignored event");
    expect(toEvent(HOOK, JSON.stringify({ type: "project.env-variable.created", payload: { team: { id: "team_evil" }, projectId: "prj_1" } }))).toBe("Wrong team for this hook");
    expect(toEvent(HOOK, JSON.stringify({ type: "project.env-variable.created", payload: { team: { id: "team_abc" } } }))).toBe("No project in the event");
    expect(toEvent(HOOK, JSON.stringify({ type: "project.env-variable.created", payload: { projectId: "" } }))).toBe("No project in the event");
    expect(toEvent(HOOK, JSON.stringify({ type: "project.env-variable.created" }))).toBe("No project in the event");
  });

  it("acts on the created and updated events only", () => {
    expect([...EVENTS]).toEqual(["project.env-variable.created", "project.env-variable.updated"]);
  });
});

describe("handle", () => {
  it("saves a signed env-variable event", async () => {
    const s = store();
    const res = await handle(await post(), s);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Saved");
    expect(s.save).toHaveBeenCalledWith({ hook_id: HOOK.id, user_id: "u1", team_id: "team_abc", project_id: "prj_1", type: "project.env-variable.created", event_id: "evt_1" });
  });

  it("acknowledges and drops other events", async () => {
    const s = store();
    const res = await handle(await post(JSON.stringify({ type: "deployment.created", payload: { projectId: "prj_1" } })), s);
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("Ignored deployment.created");
    expect(s.save).not.toHaveBeenCalled();
  });

  it("refuses anything it can't trust", async () => {
    const s = store();
    expect((await handle(await post(BODY, { method: "GET" }), s)).status).toBe(405);
    expect((await handle(await post(BODY, { hook: "not-a-uuid" }), s)).status).toBe(404);
    expect((await handle(await post(BODY, { sign: "wrong" }), s)).status).toBe(401);
    expect((await handle(await post(BODY, { sign: "" }), s)).status).toBe(401);
    expect((await handle(await post("{nope"), s)).status).toBe(400);
    expect((await handle(await post(JSON.stringify({ type: "project.env-variable.created", payload: { team: { id: "team_evil" }, projectId: "p" } })), s)).status).toBe(400);
    expect((await handle(await post(JSON.stringify({ type: "project.env-variable.created", payload: {} })), s)).status).toBe(400);
    expect((await handle(await post(), store(null))).status).toBe(404);
    expect((await handle(new Request("https://weft.example/api/vercel/webhook", { method: "POST", body: BODY }), s)).status).toBe(404);
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

  const event = { hook_id: HOOK.id, user_id: "u1", team_id: "team_abc", project_id: "prj_1", type: "project.env-variable.created", event_id: "evt_1" };

  it("reads a hook with a new-style secret key", async () => {
    const fetch = stub([new Response(JSON.stringify([HOOK]))]);
    expect(await restStore("https://db.example", "sb_secret_x").hook(HOOK.id)).toEqual(HOOK);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`https://db.example/rest/v1/vercel_hooks?id=eq.${HOOK.id}&select=id,user_id,team_id,secret`);
    expect(init?.headers).toEqual({ apikey: "sb_secret_x", "content-type": "application/json" });
  });

  it("finds no hook, and sends a legacy key as the bearer too", async () => {
    const fetch = stub([new Response("[]")]);
    expect(await restStore("https://db.example", "eyJlegacy").hook(HOOK.id)).toBeNull();
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "Bearer eyJlegacy" });
  });

  it("saves an event, takes a redelivery, and clears the hook's day-old events", async () => {
    const fetch = stub([new Response("", { status: 201 }), new Response(null, { status: 204 }), new Response("dup", { status: 409 }), new Response(null, { status: 204 })]);
    const s = restStore("https://db.example", "sb_secret_x", () => Date.UTC(2026, 9, 12));
    await s.save(event);
    await s.save(event);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://db.example/rest/v1/vercel_events");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: JSON.stringify(event), headers: { prefer: "return=minimal", apikey: "sb_secret_x" } });
    expect(fetch.mock.calls[1]?.[0]).toBe(`https://db.example/rest/v1/vercel_events?hook_id=eq.${HOOK.id}&created_at=lt.2026-10-11T00:00:00.000Z`);
    expect(fetch.mock.calls[1]?.[1]?.method).toBe("DELETE");
  });

  it("clears old events by the real clock when none is given", async () => {
    const fetch = stub([new Response("", { status: 201 }), new Response(null, { status: 204 })]);
    await restStore("https://db.example", "sb_secret_x").save(event);
    expect(fetch.mock.calls[1]?.[0]).toMatch(/created_at=lt\.\d{4}-\d\d-\d\dT/);
  });

  it("throws what Supabase said", async () => {
    stub([new Response("no table", { status: 404 }), new Response("down", { status: 500 })]);
    const s = restStore("https://db.example", "sb_secret_x");
    await expect(s.hook(HOOK.id)).rejects.toThrow("Supabase 404: no table");
    await expect(s.save(event)).rejects.toThrow("Supabase 500: down");
  });
});
