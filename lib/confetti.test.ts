import { describe, expect, it } from "vitest";
import { burst, CONFETTI_COLORS, step, type Piece } from "./confetti";

const fixed = (v: number) => () => v;

describe("burst", () => {
  it("splits the pieces between the two lower corners, aimed up and inward", () => {
    const pieces = burst(800, 720, 10, fixed(0.5));
    expect(pieces).toHaveLength(10);
    const [left, right] = pieces as [Piece, Piece];
    expect(left).toMatchObject({ x: 0, y: 720 });
    expect(right).toMatchObject({ x: 800, y: 720 });
    expect(left.vx).toBeGreaterThan(0);
    expect(right.vx).toBeLessThan(0);
    expect(left.vy).toBeLessThan(0);
    expect(CONFETTI_COLORS).toContain(left.color);
  });

  it("defaults to 160 pieces with random colors from the palette", () => {
    const pieces = burst(800, 600);
    expect(pieces).toHaveLength(160);
    expect(pieces.every((p) => CONFETTI_COLORS.includes(p.color))).toBe(true);
  });

  it("falls back to the first color if the random source hits 1", () => {
    expect(burst(800, 600, 1, fixed(1))[0]?.color).toBe(CONFETTI_COLORS[0]);
  });
});

describe("step", () => {
  const piece = (over: Partial<Piece> = {}): Piece => ({ x: 100, y: 100, vx: 0, vy: 0, rot: 0, spin: 1, flip: 0, flipSpeed: 2, w: 8, h: 10, color: "#fff", ...over });

  it("pulls pieces down, turns and flutters them", () => {
    const [p] = step([piece()], 0.1, 800, 600);
    expect(p?.vy).toBeGreaterThan(0);
    expect(p?.y).toBeGreaterThan(100);
    expect(p?.rot).toBeCloseTo(0.1);
    expect(p?.flip).toBeCloseTo(0.2);
  });

  it("slows sideways motion with drag and caps the fall speed", () => {
    const [p] = step([piece({ vx: 500, vy: 10_000 })], 0.1, 800, 600);
    expect(p?.vx).toBeLessThan(500);
    expect(p?.vy).toBe(420);
  });

  it("drops pieces that left the window", () => {
    const gone = [piece({ y: 700 }), piece({ x: -200 }), piece({ x: 1000 })];
    expect(step(gone, 0.016, 800, 600)).toEqual([]);
  });
});
