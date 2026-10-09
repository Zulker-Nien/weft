import { describe, expect, it } from "vitest";
import { fail, guard } from "./guard";

const req = (headers: Record<string, string>) => new Request("http://x/api", { headers });

describe("guard", () => {
  it("lets localhost hosts through with the write header", () => {
    for (const host of ["127.0.0.1:3456", "localhost:3456", "localhost", "[::1]:3456"]) {
      expect(guard(req({ host, "x-threadboard": "1" }))).toBeNull();
    }
  });

  it("rejects other hosts with 403, even with the header", async () => {
    for (const host of ["evil.com", "evil.com:3456", "127.0.0.1.evil.com", "localhost.evil.com:80", "0.0.0.0:3456", ""]) {
      const res = guard(req({ host, "x-threadboard": "1" }));
      expect(res?.status, host).toBe(403);
      expect((await res!.json()).error).toBe("Forbidden host");
    }
  });

  it("requires x-threadboard: 1 for writes", async () => {
    const res = guard(req({ host: "localhost:3456" }));
    expect(res?.status).toBe(403);
    expect((await res!.json()).error).toBe("Missing x-threadboard header");
    expect(guard(req({ host: "localhost:3456", "x-threadboard": "0" }))?.status).toBe(403);
    expect(guard(req({ host: "localhost:3456", "x-threadboard": "true" }))?.status).toBe(403);
  });

  it("does not need the header for reads", () => {
    expect(guard(req({ host: "localhost:3456" }), { write: false })).toBeNull();
  });

  it("still checks the host for reads", () => {
    expect(guard(req({ host: "evil.com" }), { write: false })?.status).toBe(403);
  });
});

describe("fail", () => {
  it("wraps an Error message with a 400 by default", async () => {
    const res = fail(new Error("boom"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "boom" });
  });

  it("stringifies other values and honors the status", async () => {
    const res = fail("nope", 500);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "nope" });
  });
});
