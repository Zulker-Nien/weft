import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { controlHandler, hasToken } from "./control-server.cjs";

const routes = {
  "POST /echo": (body: unknown) => ({ got: body }),
  "POST /boom": () => {
    throw new Error("kaboom");
  },
  "GET /ping": () => ({ pong: true }),
};

let server: http.Server;
let base: string;
beforeAll(async () => {
  const handle = controlHandler({ token: "s3cret", routes });
  server = http.createServer((req, res) => void handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const call = (route: string, { auth = "Bearer s3cret", body = "{}", method = "POST" } = {}) =>
  fetch(`${base}${route}`, { method, headers: auth ? { authorization: auth } : {}, body: method === "POST" ? body : undefined }).then(
    async (res) => ({ status: res.status, json: (await res.json()) as unknown }),
  );

describe("the control server's token check", () => {
  it("turns away a request with no token, a wrong one, or one of the wrong length", async () => {
    expect(await call("/echo", { auth: "" })).toEqual({ status: 401, json: { error: "Unauthorized" } });
    expect((await call("/echo", { auth: "Bearer s3crex" })).status).toBe(401);
    expect((await call("/echo", { auth: "Bearer s3cret2" })).status).toBe(401);
    expect((await call("/echo", { auth: "s3cret" })).status).toBe(401);
  });

  it("checks the token before it looks at the route", async () => {
    expect((await call("/nope", { auth: "Bearer wrong" })).status).toBe(401);
  });

  it("runs a route with the right token, handing it the JSON body", async () => {
    expect(await call("/echo", { body: '{"a":1}' })).toEqual({ status: 200, json: { got: { a: 1 } } });
    expect(await call("/echo", { body: "" })).toEqual({ status: 200, json: { got: {} } });
    expect(await call("/ping", { method: "GET" })).toEqual({ status: 200, json: { pong: true } });
  });

  it("answers 404 for a route outside the table, inherited object keys included", async () => {
    expect(await call("/missing")).toEqual({ status: 404, json: { error: "Not found" } });
    expect((await call("/echo", { method: "GET" })).status).toBe(404);
  });

  it("answers 500 with the message when a handler throws or the body isn't JSON", async () => {
    expect(await call("/boom")).toEqual({ status: 500, json: { error: "kaboom" } });
    expect((await call("/echo", { body: "{not json" })).status).toBe(500);
  });

  it("refuses to start with no token", () => {
    expect(() => controlHandler({ token: "", routes })).toThrow(/needs a token/);
  });

  it("hasToken compares the whole header", () => {
    expect(hasToken("Bearer abc", "abc")).toBe(true);
    expect(hasToken(undefined, "abc")).toBe(false);
    expect(hasToken("Bearer ab", "abc")).toBe(false);
  });
});
