import { afterEach, describe, expect, it, vi } from "vitest";
import { globalSingleton } from "./global-singleton";

const g = globalThis as unknown as { __weftTestSingleton?: unknown };

afterEach(() => {
  delete g.__weftTestSingleton;
});

describe("globalSingleton", () => {
  it("builds the value once and keeps it on globalThis", () => {
    const init = vi.fn(() => new Map<string, number>());
    const first = globalSingleton("__weftTestSingleton", init);
    const second = globalSingleton("__weftTestSingleton", init);
    expect(second).toBe(first);
    expect(g.__weftTestSingleton).toBe(first);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it("reuses a value already on globalThis, as after a dev-mode reload", () => {
    const existing = new Set(["kept"]);
    g.__weftTestSingleton = existing;
    const init = vi.fn(() => new Set<string>());
    expect(globalSingleton("__weftTestSingleton", init)).toBe(existing);
    expect(init).not.toHaveBeenCalled();
  });

  it("builds afresh once the key is deleted", () => {
    const first = globalSingleton("__weftTestSingleton", () => ({ n: 1 }));
    delete g.__weftTestSingleton;
    const second = globalSingleton("__weftTestSingleton", () => ({ n: 2 }));
    expect(second).not.toBe(first);
    expect(second).toEqual({ n: 2 });
  });
});
