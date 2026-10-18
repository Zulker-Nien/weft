import { describe, expect, it } from "vitest";
import { DAY, FIVE_HOURS, hitMarks, HOUR, leftAt, limitsChart, resetMarks, resetMs, WEEK, weekEnd, type LimitSample } from "./limit-chart";

// The status strip's limits chart: 168 hour slots of the 5-hour limit, 7 day slots of the weekly one
// with their burn-down edge, hits and reset lines.

const T0 = 1_800_000_000_000; // a whole minute
const sec = (ms: number) => ms / 1000;
const five = (at: number, used: number, reset?: number): LimitSample => ({ at, backend: "claude", kind: "five_hour", used, ...(reset !== undefined && { resetsAt: sec(reset) }) });
const week = (at: number, used: number, reset?: number): LimitSample => ({ at, backend: "claude", kind: "seven_day", used, ...(reset !== undefined && { resetsAt: sec(reset) }) });

describe("resetMs", () => {
  it("rounds a reset to the minute and passes none through", () => {
    expect(resetMs(sec(T0) + 0.419)).toBe(T0);
    expect(resetMs(sec(T0) - 0.332)).toBe(T0);
    expect(resetMs(undefined)).toBeUndefined();
  });
});

describe("weekEnd", () => {
  it("prefers the card's weekly reset, else the history's, rolled past now", () => {
    expect(weekEnd([], { sevenDay: { used: 1, resetsAt: sec(T0 + HOUR) } }, T0)).toBe(T0 + HOUR);
    expect(weekEnd([week(0, 1, T0 - HOUR)], {}, T0)).toBe(T0 - HOUR + WEEK);
    expect(weekEnd([week(0, 1)], { sevenDay: { used: 1 } }, T0)).toBeUndefined();
  });
});

describe("leftAt", () => {
  const reset = T0 + 3 * HOUR;
  const rows = [five(T0, 20, reset), five(T0 + 9 * HOUR, 30, T0 + 12 * HOUR)];

  it("is unknown before the first reading", () => {
    expect(leftAt(rows, "five_hour", T0 - 1)).toBe("unknown");
  });

  it("holds the last reading while its window is open, then goes back to full", () => {
    expect(leftAt(rows, "five_hour", T0 + HOUR)).toBe(80);
    expect(leftAt(rows, "five_hour", T0 + 5 * HOUR)).toBe(100);
  });

  it("is unknown inside a window that opened before its first reading", () => {
    expect(leftAt(rows, "five_hour", T0 + 8 * HOUR)).toBe("unknown");
    expect(leftAt(rows, "five_hour", T0 + 9 * HOUR)).toBe(70);
  });

  it("holds a reading with no reset, and puts a passed weekly reset back to full", () => {
    expect(leftAt([five(T0, 40)], "five_hour", T0 + DAY)).toBe(60);
    expect(leftAt([week(T0, 40, T0 + HOUR), week(T0 + 2 * DAY, 10, T0 + WEEK)], "seven_day", T0 + 2 * HOUR)).toBe(100);
  });
});

describe("hitMarks", () => {
  it("marks each window's first reading at 100%, jitter in its reset aside", () => {
    const rows = [five(1, 99, T0), five(2, 100, T0), five(3, 100, T0 + 300), week(4, 100, T0), five(5, 100, T0 + FIVE_HOURS)];
    expect(hitMarks(rows)).toEqual([{ at: 2, kind: "hit" }, { at: 4, kind: "hit" }, { at: 5, kind: "hit" }]);
  });
});

describe("resetMarks", () => {
  it("draws the week's end, the next reset, every 5 hours after it, and past 5-hour resets", () => {
    const start = T0 - 10 * HOUR;
    const end = T0 + 12 * HOUR;
    const rows = [five(T0 - 6 * HOUR, 5, T0 - 3 * HOUR), week(T0 - 6 * HOUR, 5, T0 - 2 * HOUR), five(T0 - 3 * HOUR, 5, end + HOUR)];
    expect(resetMarks(rows, T0 + HOUR, start, end, T0)).toEqual([
      { at: T0 - 3 * HOUR, kind: "light" },
      { at: T0 + HOUR, kind: "next" },
      { at: T0 + 6 * HOUR, kind: "light" },
      { at: T0 + 11 * HOUR, kind: "light" },
      { at: end, kind: "week" },
    ]);
  });

  it("drops a line within half an hour of one already drawn, and skips a passed next reset", () => {
    const end = T0 + 5 * HOUR + 10 * 60 * 1000;
    expect(resetMarks([], T0 + 10 * 60 * 1000, T0 - HOUR, end, T0)).toEqual([
      { at: T0 + 10 * 60 * 1000, kind: "next" },
      { at: end, kind: "week" },
    ]);
    expect(resetMarks([], T0 - HOUR, T0 - WEEK, T0 + HOUR, T0)).toEqual([{ at: T0 + HOUR, kind: "week" }]);
    expect(resetMarks([], undefined, T0 - WEEK, T0 + 2 * HOUR, T0)).toEqual([{ at: T0 + 2 * HOUR, kind: "week" }]);
  });
});

describe("limitsChart", () => {
  const end = T0 + 2 * DAY + 3 * HOUR; // the weekly reset
  const start = end - WEEK;
  const now = start + 5 * DAY + 2.5 * HOUR; // day 6, inside hour 2 (slot 122)
  const fiveReset = now + 2 * HOUR;

  it("splits the week into 168 hours and 7 days, empty ahead of now", () => {
    const chart = limitsChart([], { fiveHour: { used: 30, resetsAt: sec(fiveReset) }, sevenDay: { used: 60, resetsAt: sec(end) } }, now);
    expect([chart.start, chart.end, chart.now]).toEqual([start, end, now]);
    expect(chart.hours).toHaveLength(168);
    expect(chart.days).toHaveLength(7);
    expect(chart.hours[0]).toEqual({ from: start, to: start + HOUR, left: "unknown" });
    // The window opened 3 hours before now; the hour that holds now reads the card's current 70%.
    expect(chart.hours.at(121)?.left).toBe("unknown");
    expect(chart.hours.at(122)?.left).toBe(70);
    expect(chart.hours.at(123)?.left).toBeNull();
    expect(chart.days.map((d) => d.left)).toEqual(["unknown", "unknown", "unknown", "unknown", "unknown", 40, null]);
    expect(chart.days.at(5)?.edge).toEqual([[now, 40]]);
    expect(chart.days.at(6)?.edge).toEqual([]);
    expect(chart.marks).toContainEqual({ at: fiveReset, kind: "next" });
    expect(chart.marks).toContainEqual({ at: end, kind: "week" });
  });

  it("burns each day's edge down hour by hour from the history", () => {
    const rows = [week(start + HOUR, 10, end), week(start + 30 * HOUR, 20, end), week(start + 40 * HOUR, 35, end)];
    const chart = limitsChart(rows, { sevenDay: { used: 35, resetsAt: sec(end) } }, now);
    expect(chart.days.at(0)?.left).toBe(90);
    expect(chart.days.at(0)?.edge[0]).toEqual([start + HOUR, 90]);
    expect(chart.days.at(0)?.edge.at(-1)).toEqual([start + DAY - 1, 90]);
    expect(chart.days.at(1)?.left).toBe(65);
    expect(chart.days.at(1)?.edge.slice(0, 1)).toEqual([[start + DAY, 90]]);
    expect(chart.days.at(1)?.edge.find(([t]) => t === start + 31 * HOUR)).toEqual([start + 31 * HOUR, 80]);
    expect(chart.days.at(1)?.edge.at(-1)).toEqual([start + 2 * DAY - 1, 65]);
  });

  it("adds no reading when the card's windows match the history, and marks a hit", () => {
    const rows = [five(now - HOUR, 100, fiveReset), week(now - HOUR, 50, end)];
    const chart = limitsChart(rows, { fiveHour: { used: 100, resetsAt: sec(fiveReset) + 0.4 }, sevenDay: { used: 50, resetsAt: sec(end) } }, now);
    expect(chart.marks).toContainEqual({ at: now - HOUR, kind: "hit" });
    expect(chart.hours.at(122)?.left).toBe(0);
  });

  it("leaves out a card's window that has already reset or is older than the history", () => {
    const sevenDay = { used: 0, resetsAt: sec(end) };
    const stale = limitsChart([], { fiveHour: { used: 63, resetsAt: sec(now - HOUR) }, sevenDay }, now);
    expect(stale.hours.at(122)?.left).toBe("unknown");
    const older = limitsChart([five(now - HOUR, 10, now + 3 * HOUR)], { fiveHour: { used: 63, resetsAt: sec(now + HOUR) }, sevenDay }, now);
    expect(older.hours.at(122)?.left).toBe(90);
  });

  it("ignores readings after now and spans 7 days ending 5 hours out without a weekly reset", () => {
    const chart = limitsChart([five(T0 + HOUR, 10)], {}, T0);
    expect([chart.start, chart.end]).toEqual([T0 + FIVE_HOURS - WEEK, T0 + FIVE_HOURS]);
    expect(chart.hours.every((h) => h.left === null || h.left === "unknown")).toBe(true);
  });
});
