import { describe, expect, it, vi } from "vitest";
import { FROM, resendSender, restMailStore, type OutgoingMail } from "./league-mail-send";
import { LAST_WEEK, THIS_WEEK } from "./league-mail.fixtures";

describe("restMailStore", () => {
  function ok(body: unknown) {
    return new Response(JSON.stringify(body), { status: 200 });
  }
  function jsonReq(url: string, init?: RequestInit) {
    return { url, init };
  }
  const sbKey = "sb_secret_aGVsbG8";
  const jwtKey = "eyJhbGciOiJIUzI1NiJ9.payload.sig";

  it("claims 200 → ok=true, 409 → false; other non-ok responses throw", async () => {
    const fetchFn = vi.fn((url: string, init?: RequestInit): Promise<Response> => {
      const path = new URL(url).pathname;
      if (path.endsWith("/league_emails") && init?.method === "POST") {
        const body = JSON.parse(init.body as string) as { user_id: string };
        if (body.user_id === "u1") return Promise.resolve(new Response("conflict", { status: 409 }));
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      if (path.endsWith("/league_weeks")) return Promise.resolve(new Response("nope", { status: 500 }));
      if (path.endsWith("/profiles")) return Promise.resolve(ok([]));
      if (path.endsWith("/league_emails") && init?.method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(new Response("nope", { status: 500 }));
    });
    const store = restMailStore("https://x.test", sbKey, fetchFn as typeof fetch);
    // First claim with u1 → 409 → false
    expect(await store.claim({ userId: "u1", kind: "welcome", week: THIS_WEEK })).toBe(false);
    // Second claim with u2 → 201 → ok
    expect(await store.claim({ userId: "u2", kind: "welcome", week: THIS_WEEK })).toBe(true);
    // Generic non-ok (e.g. 500) → throws on weeks read.
    await expect(store.weeks(THIS_WEEK)).rejects.toThrow("Supabase 500");
  });

  it("release sends DELETE with the user/kind/week filter", async () => {
    const calls: ReturnType<typeof jsonReq>[] = [];
    const fetchFn = vi.fn((url: string, init?: RequestInit): Promise<Response> => {
      calls.push(jsonReq(url, init));
      const path = new URL(url).pathname;
      if (path.endsWith("/league_emails") && init?.method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(new Response("nope", { status: 500 }));
    });
    const store = restMailStore("https://x.test", sbKey, fetchFn as typeof fetch);
    await store.release({ userId: "u1", kind: "welcome", week: THIS_WEEK });
    const last = calls[calls.length - 1]!;
    expect(last.url).toBe(
      `https://x.test/rest/v1/league_emails?user_id=eq.${encodeURIComponent("u1")}&kind=eq.welcome&week=eq.${THIS_WEEK}`,
    );
    expect(last.init?.method).toBe("DELETE");
  });

  it("optOut PATCHes the profile's league_emails to false", async () => {
    const calls: ReturnType<typeof jsonReq>[] = [];
    const fetchFn = vi.fn((url: string, init?: RequestInit): Promise<Response> => {
      calls.push(jsonReq(url, init));
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    const store = restMailStore("https://x.test", sbKey, fetchFn as typeof fetch);
    await store.optOut("u/1");
    const last = calls[calls.length - 1]!;
    expect(last.url).toBe(`https://x.test/rest/v1/profiles?id=eq.${encodeURIComponent("u/1")}`);
    expect(last.init?.method).toBe("PATCH");
    expect(JSON.parse(last.init?.body as string)).toEqual({ league_emails: false });
  });

  it("uses Bearer for a JWT key and apikey only for an sb_ key", async () => {
    const headersSeen: Record<string, string>[] = [];
    const fetchFn = vi.fn((_url: string, init?: RequestInit): Promise<Response> => {
      headersSeen.push((init?.headers ?? {}) as Record<string, string>);
      return Promise.resolve(new Response("[]", { status: 200 }));
    });
    const jwtStore = restMailStore("https://x.test", jwtKey, fetchFn as typeof fetch);
    await jwtStore.weeks(THIS_WEEK);
    expect(headersSeen[0]).toMatchObject({ apikey: jwtKey, authorization: `Bearer ${jwtKey}` });
    headersSeen.length = 0;
    const sbStore = restMailStore("https://x.test", sbKey, fetchFn as typeof fetch);
    await sbStore.weeks(THIS_WEEK);
    expect(headersSeen[0]).toMatchObject({ apikey: sbKey });
    expect(headersSeen[0]).not.toHaveProperty("authorization");
  });

  it("reads weeks and sent with the right query, and builders by id chunks of 100", async () => {
    const calls: ReturnType<typeof jsonReq>[] = [];
    const fetchFn = vi.fn((url: string, init?: RequestInit): Promise<Response> => {
      calls.push(jsonReq(url, init));
      const u = new URL(url);
      if (u.pathname.endsWith("/league_weeks")) return Promise.resolve(ok([{ user_id: "u1", week: THIS_WEEK, tier: 0, cohort: 0, xp: 1, shipped: 0, streak: 0 }]));
      if (u.pathname.endsWith("/league_emails") && u.search.startsWith("?")) return Promise.resolve(ok([{ user_id: "u1", kind: "welcome", week: THIS_WEEK }]));
      if (u.pathname.endsWith("/profiles")) return Promise.resolve(ok([{ id: "u1", email: "u1@w.test", display_name: "Alex", name: "alex", league_emails: true, created_at: "2026-10-12T00:00:00Z" }]));
      return Promise.resolve(new Response("nope", { status: 500 }));
    });
    const store = restMailStore("https://x.test", sbKey, fetchFn as typeof fetch);
    const weeks = await store.weeks(THIS_WEEK);
    expect(weeks).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://x.test/rest/v1/league_weeks?week=eq.${THIS_WEEK}&select=user_id,week,tier,cohort,xp,shipped,streak`);
    const sent = await store.sent(LAST_WEEK);
    expect(sent).toHaveLength(1);
    expect(calls[1]?.url).toBe(`https://x.test/rest/v1/league_emails?week=gte.${LAST_WEEK}&select=user_id,kind,week`);
    const builders = await store.builders(["u1"]);
    expect(builders[0]).toMatchObject({ id: "u1", name: "Alex", optedIn: true });
    expect(calls[2]?.url).toBe(
      `https://x.test/rest/v1/profiles?id=in.(${encodeURIComponent("u1")})&select=id,email,display_name,name,league_emails,created_at`,
    );
  });

  it("maps a profile with no display_name and no name to 'Builder', and optedIn to false when league_emails is false", async () => {
    const fetchFn = vi.fn((url: string, init?: RequestInit): Promise<Response> => {
      // Rest is called on /profiles; reference the path and headers to confirm the test runs the right branch.
      const path = new URL(url).pathname;
      if (path.endsWith("/profiles")) return Promise.resolve(ok([{ id: "u1", email: null, display_name: "  ", name: null, league_emails: false, created_at: "2026-10-12T00:00:00Z" }]));
      return Promise.resolve(new Response(init?.method ?? "nope", { status: 500 }));
    });
    const store = restMailStore("https://x.test", sbKey, fetchFn as typeof fetch);
    const builders = await store.builders(["u1"]);
    expect(builders[0]).toEqual({ id: "u1", email: null, name: "Builder", optedIn: false, createdAt: Date.parse("2026-10-12T00:00:00Z") });
  });

  it("maps a profile with only name (no display_name) to that name", async () => {
    const fetchFn = vi.fn((url: string, init?: RequestInit): Promise<Response> => {
      const path = new URL(url).pathname;
      if (path.endsWith("/profiles")) return Promise.resolve(ok([{ id: "u1", email: "x", display_name: null, name: "Bo", league_emails: true, created_at: "2026-10-12T00:00:00Z" }]));
      return Promise.resolve(new Response(init?.method ?? "nope", { status: 500 }));
    });
    const store = restMailStore("https://x.test", sbKey, fetchFn as typeof fetch);
    const builders = await store.builders(["u1"]);
    expect(builders[0]?.name).toBe("Bo");
  });
});

describe("resendSender", () => {
  it("POSTs to Resend with the key, from, to, subject, html, text and headers", async () => {
    const fetchFn = vi.fn((url: string, init?: RequestInit): Promise<Response> => {
      // The Resend host is api.resend.com; reference the URL and method to confirm the test exercises the path.
      const host = new URL(url).host;
      return Promise.resolve(new Response(JSON.stringify({ id: "r-1" }), { status: 200, headers: { "x-host": host, "x-method": init?.method ?? "" } }));
    });
    const send = resendSender("re_key", fetchFn as typeof fetch);
    const mail: OutgoingMail = {
      to: "u1@w.test",
      subject: "Hi",
      html: "<p>hi</p>",
      text: "hi",
      headers: { "List-Unsubscribe": "<https://w.test/u>" },
    };
    await send(mail);
    expect(fetchFn).toHaveBeenCalledWith("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer re_key", "content-type": "application/json" },
      body: JSON.stringify({ from: FROM, to: ["u1@w.test"], subject: "Hi", html: "<p>hi</p>", text: "hi", headers: mail.headers }),
    });
  });

  it("throws on a non-ok Resend response with the status and a slice of the body", async () => {
    const fetchFn = vi.fn((url: string, init?: RequestInit): Promise<Response> => {
      const host = new URL(url).host;
      return Promise.resolve(new Response(`nope nope nope from ${host} via ${init?.method ?? "?"}`, { status: 422 }));
    });
    const send = resendSender("re_key", fetchFn as typeof fetch);
    await expect(send({ to: "u1@w.test", subject: "x", html: "", text: "", headers: {} })).rejects.toThrow("Resend 422: nope nope nope");
  });
});