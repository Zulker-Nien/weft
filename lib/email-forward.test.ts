import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forwardMessage, handle, parseAddress, refusal, restMailer, sameSignature, shouldDrop, svixSignature, TOLERANCE, type Mail, type Mailer, type Received } from "./email-forward";

// The forwarder's checks (Svix's signature and timestamp, the event), the mail it builds, and its client on Resend's API.

// Built here so no key-shaped literal sits in the file for the pre-commit secret scan to trip on.
const SECRET = `whsec_${Buffer.from("a test signing key, 24 bytes").toString("base64")}`;
const NOW = 1_760_000_000_000;
const TS = String(NOW / 1000);
const BODY = JSON.stringify({ type: "email.received", data: { email_id: "e-1" } });
const MAIL: Mail = { from: "Jane Doe <jane@acme.test>", to: ["hello@weft.zip"], reply_to: [], subject: "Hi there", html: "<p>Hi</p>", text: "Hi" };
const FILE: Received = { filename: "a.pdf", content_type: "application/pdf", content_disposition: "attachment", download_url: "https://dl.test/a" };
const INLINE: Received = { filename: "img.png", content_type: "image/png", content_disposition: "inline", download_url: "https://dl.test/i" };

const sign = (ts: string, body: string) => `v1,${createHmac("sha256", Buffer.from(SECRET.slice("whsec_".length), "base64")).update(`msg_1.${ts}.${body}`).digest("base64")}`;

function post(body = BODY, { ts = TS, signature = sign(ts, body), method = "POST" } = {}) {
  const headers: Record<string, string> = { "svix-id": "msg_1", "svix-timestamp": ts };
  if (signature) headers["svix-signature"] = signature;
  return new Request("https://weft.example/api/email/webhook", { method, headers, body: method === "POST" ? body : undefined });
}

function mailer(mail = MAIL, files: Received[] = []) {
  return {
    received: vi.fn(() => Promise.resolve(mail)),
    attachments: vi.fn(() => Promise.resolve(files)),
    download: vi.fn((url: string) => Promise.resolve(`b64:${url}`)),
    send: vi.fn(() => Promise.resolve("sent-1")),
  } satisfies Mailer;
}

const forwarding = (m = mailer()) => ({ secret: SECRET, to: "me@gmail.test", from: "forward@weft.zip", mailer: m, now: NOW });

describe("svixSignature", () => {
  it("is the base64 HMAC-SHA256 of id.timestamp.body, keyed by the decoded secret", async () => {
    expect(`v1,${await svixSignature(SECRET, "msg_1", TS, BODY)}`).toBe(sign(TS, BODY));
    expect(await svixSignature(SECRET, "msg_2", TS, BODY)).not.toBe(await svixSignature(SECRET, "msg_1", TS, BODY));
  });

  it("compares in full", () => {
    expect(sameSignature("abc", "abc")).toBe(true);
    expect(sameSignature("abc", "abd")).toBe(false);
    expect(sameSignature("abc", "abcd")).toBe(false);
  });
});

describe("refusal", () => {
  const headers = (over: Record<string, string | null> = {}, body = BODY) => {
    const req = post(body);
    for (const [name, value] of Object.entries(over)) {
      if (value === null) req.headers.delete(name);
      else req.headers.set(name, value);
    }
    return req.headers;
  };

  it("trusts a fresh, signed delivery, by the clock when no time is given", async () => {
    expect(await refusal(headers(), BODY, SECRET, NOW)).toBeNull();
    vi.useFakeTimers();
    vi.setSystemTime(NOW + 1000);
    expect(await refusal(headers(), BODY, SECRET)).toBeNull();
    vi.useRealTimers();
  });

  it("wants all three headers", async () => {
    for (const name of ["svix-id", "svix-timestamp", "svix-signature"]) {
      expect(await refusal(headers({ [name]: null }), BODY, SECRET, NOW)).toBe("Missing signature headers");
    }
  });

  it("rejects a stale or unreadable timestamp", async () => {
    const old = String(NOW / 1000 - TOLERANCE - 1);
    expect(await refusal(headers({ "svix-timestamp": old, "svix-signature": sign(old, BODY) }), BODY, SECRET, NOW)).toBe("Stale timestamp");
    const edge = String(NOW / 1000 - TOLERANCE);
    expect(await refusal(headers({ "svix-timestamp": edge, "svix-signature": sign(edge, BODY) }), BODY, SECRET, NOW)).toBeNull();
    expect(await refusal(headers({ "svix-timestamp": "soon" }), BODY, SECRET, NOW)).toBe("Stale timestamp");
  });

  it("takes any v1 signature in the list and no other version", async () => {
    expect(await refusal(headers({ "svix-signature": `v2,${sign(TS, BODY).slice(3)} ${sign(TS, BODY)}` }), BODY, SECRET, NOW)).toBeNull();
    expect(await refusal(headers({ "svix-signature": `v2,${sign(TS, BODY).slice(3)}` }), BODY, SECRET, NOW)).toBe("Bad signature");
    expect(await refusal(headers({ "svix-signature": "v1,nope" }), BODY, SECRET, NOW)).toBe("Bad signature");
    expect(await refusal(headers(), `${BODY} `, SECRET, NOW)).toBe("Bad signature");
    expect(await refusal(headers(), BODY, "whsec_b3RoZXI=", NOW)).toBe("Bad signature");
  });
});

describe("parseAddress", () => {
  it("splits a name from its address", () => {
    expect(parseAddress("Jane Doe <jane@acme.test>")).toEqual({ name: "Jane Doe", address: "jane@acme.test" });
    expect(parseAddress('"Doe, Jane" <jane@acme.test>')).toEqual({ name: "Doe, Jane", address: "jane@acme.test" });
    expect(parseAddress(" <jane@acme.test> ")).toEqual({ name: "", address: "jane@acme.test" });
    expect(parseAddress(" jane@acme.test ")).toEqual({ name: "", address: "jane@acme.test" });
  });
});

describe("forwardMessage", () => {
  const send = (over: Partial<Mail> = {}, attachments: { filename: string; content: string; content_type: string }[] = []) =>
    forwardMessage({ ...MAIL, ...over }, "me@gmail.test", "forward@weft.zip", attachments);

  it("comes from the forwarding address, named for the sender and the alias, replying to the sender", () => {
    expect(send()).toEqual({
      from: '"Jane Doe via hello@weft.zip" <forward@weft.zip>',
      to: ["me@gmail.test"],
      reply_to: ["jane@acme.test"],
      subject: "Hi there",
      html: "<p>Hi</p>",
      text: "Hi",
      headers: { "X-Forwarded-From": "Jane Doe <jane@acme.test>", "X-Forwarded-To": "hello@weft.zip" },
    });
  });

  it("names a bare sender by their address, keeps their reply-to, and quotes safely", () => {
    expect(send({ from: "jane@acme.test", reply_to: ["bounce@acme.test"], to: ["hello@weft.zip", "team@weft.zip"] })).toMatchObject({
      from: '"jane@acme.test via hello@weft.zip" <forward@weft.zip>',
      reply_to: ["bounce@acme.test"],
      headers: { "X-Forwarded-To": "hello@weft.zip, team@weft.zip" },
    });
    expect(send({ from: 'Jane "JD" Doe <jd@acme.test>', to: [] }).from).toBe(`"Jane 'JD' Doe via forward@weft.zip" <forward@weft.zip>`);
  });

  it("sends whichever bodies there are, and a note when there are none", () => {
    expect(send({ text: null })).not.toHaveProperty("text");
    expect(send({ html: null })).not.toHaveProperty("html");
    expect(send({ html: null, text: null, subject: "" })).toMatchObject({ text: "(no content)", subject: "(no subject)" });
    expect(send()).not.toHaveProperty("attachments");
    expect(send({}, [{ filename: "a.pdf", content: "aGk=", content_type: "application/pdf" }]).attachments).toHaveLength(1);
  });
});

describe("handle", () => {
  it("reads a signed delivery back from Resend and sends it on, with its real attachments", async () => {
    const m = mailer(MAIL, [FILE, INLINE]);
    const res = await handle(post(), forwarding(m));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Forwarded as sent-1");
    expect(m.received).toHaveBeenCalledWith("e-1");
    expect(m.download).toHaveBeenCalledTimes(1);
    expect(m.send).toHaveBeenCalledWith(expect.objectContaining({ to: ["me@gmail.test"], attachments: [{ filename: "a.pdf", content_type: "application/pdf", content: "b64:https://dl.test/a" }] }));
  });

  it("acknowledges and drops what isn't a received email", async () => {
    const m = mailer();
    for (const body of ["{}", "null", JSON.stringify({ type: "email.sent" }), JSON.stringify({ type: "email.received", data: {} })]) {
      expect((await handle(post(body), forwarding(m))).status).toBe(202);
    }
    expect(await (await handle(post(JSON.stringify({ type: "email.sent" })), forwarding(m))).text()).toBe("Ignored email.sent");
    expect(await (await handle(post("{}"), forwarding(m))).text()).toBe("Ignored event");
    expect(m.received).not.toHaveBeenCalled();
  });

  it("refuses anything it can't trust", async () => {
    const m = mailer();
    expect((await handle(post(BODY, { method: "GET" }), forwarding(m))).status).toBe(405);
    expect((await handle(post(BODY, { signature: "v1,nope" }), forwarding(m))).status).toBe(401);
    expect((await handle(post(BODY, { signature: "" }), forwarding(m))).status).toBe(401);
    expect((await handle(post("{nope"), forwarding(m))).status).toBe(400);
    expect(m.received).not.toHaveBeenCalled();
  });

  it("lets Resend's failures through to the route", async () => {
    const m = mailer();
    m.send.mockRejectedValueOnce(new Error("Resend 422 on /emails: bad"));
    await expect(handle(post(), forwarding(m))).rejects.toThrow("Resend 422");
  });

  it("drops DMARC aggregate reports and postmaster notices with a 200 so Resend doesn't retry", async () => {
    const forMail = (to: string[]) => mailer({ ...MAIL, to });
    for (const [to, why] of [
      [["dmarc@weft.zip"], "dmarc@ mail"],
      [["postmaster@weft.zip"], "postmaster@ mail"],
      [["abuse@weft.zip"], "abuse@ mail"],
      [["dmarc-ripe@weft.zip"], "dmarc@ mail"],
    ] as const) {
      const m = forMail([...to]);
      const res = await handle(post(), forwarding(m));
      expect(res.status, why).toBe(200);
      expect(await res.text(), why).toBe(`Dropped ${why}`);
      expect(m.send, why).not.toHaveBeenCalled();
    }
  });

  it("drops the whole mail when any recipient is a dropped alias, so a CC'd real local isn't forwarded", async () => {
    const m = mailer({ ...MAIL, to: ["hello@weft.zip", "dmarc@weft.zip"] });
    const res = await handle(post(), forwarding(m));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Dropped dmarc@ mail");
    expect(m.send).not.toHaveBeenCalled();
  });
});

describe("shouldDrop", () => {
  const t = (to: string[]) => shouldDrop({ to });
  it("drops dmarc, postmaster and abuse locals (and their sub-addresses)", () => {
    expect(t(["dmarc@weft.zip"])).toBe("dmarc@ mail");
    expect(t(["postmaster@weft.zip"])).toBe("postmaster@ mail");
    expect(t(["abuse@weft.zip"])).toBe("abuse@ mail");
    expect(t(["dmarc-ripe@weft.zip"])).toBe("dmarc@ mail");
    expect(t(["DMARC@weft.zip"])).toBe("dmarc@ mail");
  });
  it("leaves real addresses alone", () => {
    expect(t(["hello@weft.zip"])).toBeNull();
    expect(t(["test+dmark@weft.zip"])).toBeNull();
    expect(t(["user@weft.zip", "abuse@weft.zip"])).toBe("abuse@ mail");
    expect(t([])).toBeNull();
    expect(t(["not-an-address"])).toBeNull();
  });
});

describe("restMailer", () => {
  afterEach(() => vi.unstubAllGlobals());
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const resend = () =>
    vi.fn((url: string, init?: RequestInit) => {
      if (url === "https://api.resend.com/emails/receiving/e-1") return ok(MAIL);
      if (url === "https://api.resend.com/emails/receiving/e-1/attachments") return ok({ data: [FILE] });
      if (url === "https://api.resend.com/emails/receiving/e-2/attachments") return ok({});
      if (url === "https://dl.test/a") return new Response(new Uint8Array([104, 105]));
      if (url === "https://dl.test/gone") return new Response("expired", { status: 403 });
      if (url === "https://api.resend.com/emails" && init?.method === "POST") return ok({ id: "sent-9" });
      return new Response("nope", { status: 401 });
    });

  it("reads a received mail, lists its attachments, downloads one and sends, with the key", async () => {
    const fetchFn = resend();
    const m = restMailer("re_key", fetchFn as unknown as typeof fetch);
    expect(await m.received("e-1")).toEqual(MAIL);
    expect(await m.attachments("e-1")).toEqual([FILE]);
    expect(await m.attachments("e-2")).toEqual([]);
    expect(await m.download("https://dl.test/a")).toBe("aGk=");
    expect(await m.send(forwardMessage(MAIL, "me@gmail.test", "forward@weft.zip", []))).toBe("sent-9");
    expect(fetchFn).toHaveBeenCalledWith("https://api.resend.com/emails/receiving/e-1", { headers: { authorization: "Bearer re_key", "content-type": "application/json" } });
    expect(fetchFn).toHaveBeenLastCalledWith("https://api.resend.com/emails", {
      method: "POST",
      body: JSON.stringify(forwardMessage(MAIL, "me@gmail.test", "forward@weft.zip", [])),
      headers: { authorization: "Bearer re_key", "content-type": "application/json" },
    });
  });

  it("says what Resend answered when a call fails", async () => {
    const m = restMailer("re_key", resend() as unknown as typeof fetch);
    await expect(m.received("e-9")).rejects.toThrow("Resend 401 on /emails/receiving/e-9: nope");
    await expect(m.download("https://dl.test/gone")).rejects.toThrow("Resend 403 downloading an attachment");
  });

  it("uses the global fetch by default", async () => {
    vi.stubGlobal("fetch", resend());
    expect(await restMailer("re_key").received("e-1")).toEqual(MAIL);
  });
});
