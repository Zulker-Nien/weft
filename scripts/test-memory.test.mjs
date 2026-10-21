import { describe, expect, it } from "vitest";
import { checkMemoryPressure, freeMemoryMb, pressureMessage, MIN_FREE_MB } from "./test-memory.mjs";

describe("freeMemoryMb", () => {
  it("counts free + inactive + purgeable, minus swap already used", () => {
    // 3 GB available in the file cache, 1 GB already swapped out => 2 GB genuinely free.
    const gb = 1e9;
    expect(freeMemoryMb({ free: gb, inactive: gb, purgeable: gb, }, gb)).toBe(2000);
  });
  it("never reports negative memory when swap exceeds the cache", () => {
    expect(freeMemoryMb({ free: 1e6, inactive: 1e6, purgeable: 1e6 }, 9e9)).toBeLessThan(0);
  });
});

describe("checkMemoryPressure", () => {
  it("reports the machine's real total and a free-memory figure", () => {
    const p = checkMemoryPressure();
    expect(p.totalMb).toBeGreaterThan(1000);
    expect(typeof p.freeMb).toBe("number");
    expect(p.swapUsedMb).toBeGreaterThanOrEqual(0);
  });
  it("marks a machine with enough memory ok, and a starved one not ok", () => {
    // Passing an absurd threshold can only fail; passing 0 can only pass.
    expect(checkMemoryPressure(0).ok).toBe(true);
    expect(checkMemoryPressure(1_000_000).ok).toBe(false);
  });
  it("uses a sane default threshold", () => {
    expect(MIN_FREE_MB).toBeGreaterThan(512);
    expect(MIN_FREE_MB).toBeLessThan(8192);
  });
});

describe("pressureMessage", () => {
  it("tells the user what's available, what's needed, and how to run anyway", () => {
    const msg = pressureMessage({ freeMb: 900, swapUsedMb: 1600, totalMb: 16384, ok: false }, 2048);
    expect(msg).toContain("900 MB available");
    expect(msg).toContain("16384 MB");
    expect(msg).toContain("1600 MB already swapped");
    expect(msg).toContain("2048 MB free");
    expect(msg).toContain("MAX_WORKERS=1");
  });
});