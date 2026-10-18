import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, guard } from "./guard";

const token = vi.hoisted(() => ({ value: "" }));
vi.mock("./shell-token", () => ({ shellToken: () => token.value }));
beforeEach(() => {
  token.value = "";
});

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
      expect(((await res!.json()) as { error: string }).error).toBe("Forbidden host");
    }
  });

  it("requires x-threadboard: 1 for writes", async () => {
    const res = guard(req({ host: "localhost:3456" }));
    expect(res?.status).toBe(403);
    expect(((await res!.json()) as { error: string }).error).toBe("Missing x-threadboard header");
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

describe("guard without a Host header", () => {
  it("treats a missing Host as foreign", async () => {
    const res = guard(new Request("http://x/api"), { write: false });
    expect(res?.status).toBe(403);
    expect(await res!.json()).toEqual({ error: "Forbidden host" });
  });
});

describe("guard sensitive reads", () => {
  const read = (headers: Record<string, string>) => guard(req({ host: "localhost:3456", ...headers }), { write: false, sensitive: true });

  it("needs the launch token when the desktop app has one", async () => {
    token.value = "secret-token";
    expect(read({})?.status).toBe(403);
    expect(read({ "x-weft-token": "wrong-token!" })?.status).toBe(403);
    expect(read({ "x-weft-token": "short" })?.status).toBe(403);
    expect(((await read({})!.json()) as { error: string }).error).toBe("Missing token");
    expect(read({ "x-weft-token": "secret-token" })).toBeNull();
  });

  it("asks nothing where there is no token (a browser, tests)", () => {
    expect(read({})).toBeNull();
  });

  it("still checks the host first", () => {
    token.value = "t";
    expect(guard(req({ host: "evil.com", "x-weft-token": "t" }), { write: false, sensitive: true })?.status).toBe(403);
  });
});
