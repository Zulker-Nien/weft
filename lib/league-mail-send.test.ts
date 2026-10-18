import { afterEach, describe, expect, it, vi } from "vitest";
import { outgoing, runLeagueMails, SEND_GAP_MS, unsubscribeUrl, verifyUnsubscribe, type MailStore } from "./league-mail-send";
import { makeStore, NOW, ORIGIN, SECRET, sign, welcomeMail } from "./league-mail.fixtures";

describe("unsubscribeUrl and verifyUnsubscribe", () => {
  it("builds an HMAC-signed unsubscribe link and verifies it", () => {
    const url = unsubscribeUrl(ORIGIN, "u-1", SECRET);
    expect(url).toBe(`${ORIGIN}/api/league/unsubscribe?u=u-1&t=${sign("u-1")}`);
    expect(verifyUnsubscribe("u-1", sign("u-1"), SECRET)).toBe(true);
  });

  it("URL-encodes a user id with a space or slash", () => {
    const url = unsubscribeUrl(ORIGIN, "u 1/a", SECRET);
    expect(url).toBe(`${ORIGIN}/api/league/unsubscribe?u=u%201%2Fa&t=${sign("u 1/a")}`);
    expect(verifyUnsubscribe("u 1/a", sign("u 1/a"), SECRET)).toBe(true);
  });

  it("rejects a token for a different user", () => {
    const token = sign("u-1");
    expect(verifyUnsubscribe("u-2", token, SECRET)).toBe(false);
  });

  it("rejects a wrong token of the same length", () => {
    const token = sign("u-1");
    const wrong = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(verifyUnsubscribe("u-1", wrong, SECRET)).toBe(false);
  });

  it("rejects a token of a different length (and doesn't throw on timingSafeEqual)", () => {
    expect(verifyUnsubscribe("u-1", "short", SECRET)).toBe(false);
    expect(verifyUnsubscribe("u-1", sign("u-1") + "x", SECRET)).toBe(false);
  });
});

describe("outgoing", () => {
  it("returns the recipient, subject, html, text and the RFC 8058 one-click headers", () => {
    const mail = outgoing(welcomeMail(), ORIGIN, SECRET);
    expect(mail.to).toBe("u1@w.test");
    expect(mail.subject).toBe("Welcome to the Cotton league");
    expect(mail.html).toContain("Welcome to the Cotton league");
    expect(mail.text).toContain("Open your league");
    expect(mail.headers).toEqual({
      "List-Unsubscribe": `<${unsubscribeUrl(ORIGIN, "u1", SECRET)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});

describe("runLeagueMails", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("plans and sends each mail, sleeping SEND_GAP_MS between them", async () => {
    const { store, getSend, sent } = makeStore();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const result = await runLeagueMails({ store, send: getSend(), origin: ORIGIN, secret: SECRET, now: NOW });
    // Sunday → 2 welcomes (u1, u2 both in welcome window).
    expect(result.planned).toBe(2);
    expect(result.sent).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toEqual([]);
    expect(sent.map((s) => s.to).sort()).toEqual(["u1@w.test", "u2@w.test"]);
    // After the first send, runLeagueMails waits SEND_GAP_MS before the next.
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), SEND_GAP_MS);
    setTimeoutSpy.mockRestore();
  });

  it("skips a mail when the store's claim returns false", async () => {
    const { store, getSend, sent } = makeStore();
    // Pre-claim u1 so the run finds it already taken.
    const wrapped: MailStore = {
      ...store,
      claim: (m) => Promise.resolve(m.userId !== "u1"),
    };
    const result = await runLeagueMails({ store: wrapped, send: getSend(), origin: ORIGIN, secret: SECRET, now: NOW, gapMs: 0 });
    expect(result.skipped).toBe(1);
    expect(result.sent).toBe(1);
    expect(sent.map((s) => s.to)).toEqual(["u2@w.test"]);
  });

  it("releases a mail and counts it as failed when send throws", async () => {
    const releases: string[] = [];
    const { store, setSend, getSend } = makeStore();
    const wrapped: MailStore = {
      ...store,
      release: async (m) => {
        releases.push(`${m.userId}:${m.kind}:${m.week}`);
        await store.release(m);
      },
    };
    setSend(() => Promise.reject(new Error("Resend 422: bad")));
    const result = await runLeagueMails({ store: wrapped, send: getSend(), origin: ORIGIN, secret: SECRET, now: NOW, gapMs: 0 });
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0]).toContain("Resend 422");
    // Both failed mails were released so a later run can try again.
    expect(releases).toHaveLength(2);
  });

  it("uses gapMs 0 to skip the inter-send wait", async () => {
    const { store, getSend, sent } = makeStore();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const result = await runLeagueMails({ store, send: getSend(), origin: ORIGIN, secret: SECRET, now: NOW, gapMs: 0 });
    expect(result.sent).toBe(2);
    expect(sent).toHaveLength(2);
    // No SEND_GAP_MS waits were scheduled.
    expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), SEND_GAP_MS);
    setTimeoutSpy.mockRestore();
  });

  it("plans nothing when no rows are returned for either week", async () => {
    const store: MailStore = {
      weeks: () => Promise.resolve([]),
      builders: () => Promise.resolve([]),
      sent: () => Promise.resolve([]),
      claim: () => Promise.resolve(true),
      release: () => Promise.resolve(),
      optOut: () => Promise.resolve(),
    };
    const sendMock = vi.fn();
    const result = await runLeagueMails({ store, send: sendMock, origin: ORIGIN, secret: SECRET, now: NOW });
    expect(result).toEqual({ planned: 0, sent: 0, skipped: 0, failed: [] });
    expect(sendMock).not.toHaveBeenCalled();
  });
});