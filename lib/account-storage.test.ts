import { describe, expect, it, vi } from "vitest";
import { shellStorage } from "./account-storage";

function fakeMain(start: Record<string, string> = {}) {
  let saved = { ...start };
  const fetchFn = vi.fn((url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { data?: Record<string, string> };
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    if (url.endsWith("/account/read")) return Promise.resolve(new Response(JSON.stringify({ data: saved })));
    saved = body.data ?? {};
    return Promise.resolve(new Response(JSON.stringify({ ok: true })));
  });
  return { fetchFn, saved: () => saved };
}

describe("shellStorage", () => {
  it("reads once, then serves reads from memory and writes every change through to main", async () => {
    const main = fakeMain({ a: "1" });
    const storage = shellStorage("http://main", "tok", main.fetchFn as unknown as typeof fetch);
    expect(await storage.getItem("a")).toBe("1");
    expect(await storage.getItem("b")).toBeNull();
    expect(main.fetchFn).toHaveBeenCalledTimes(1);
    await storage.setItem("b", "2");
    expect(main.saved()).toEqual({ a: "1", b: "2" });
    await storage.removeItem("a");
    expect(main.saved()).toEqual({ b: "2" });
    expect(await storage.getItem("b")).toBe("2");
    expect(main.fetchFn).toHaveBeenCalledTimes(3);
    expect(main.fetchFn.mock.calls[0]![0]).toBe("http://main/account/read");
  });

  it("treats a read with no data as signed out", async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response(JSON.stringify({}))));
    expect(await shellStorage("http://main", "tok", fetchFn as unknown as typeof fetch).getItem("a")).toBeNull();
  });

  it("asks main again after a failed read, and reports main's error", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Keychain locked" }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { a: "1" } })));
    const storage = shellStorage("http://main", "tok", fetchFn);
    await expect(storage.getItem("a")).rejects.toThrow("Keychain locked");
    await expect(storage.getItem("a")).rejects.toThrow("The desktop app said 401.");
    expect(await storage.getItem("a")).toBe("1");
  });

  it("uses the global fetch by default", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { a: "x" } })));
    expect(await shellStorage("http://main", "tok").getItem("a")).toBe("x");
    spy.mockRestore();
  });
});
