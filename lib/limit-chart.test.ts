import { describe, expect, it } from "vitest";
import { burndown, FIVE_HOURS, fiveHourLine, hitMarks, HOUR, resetMarks, WEEK, weekEnd, type LimitSample } from "./limit-chart";

// The status strip's burndown: the weekly and 5-hour lines, hits, and the reset lines.

const T0 = 1_800_000_000_000;
const sec = (ms: number) => ms / 1000;
const five = (at: number, used: number, reset?: number): LimitSample => ({ at, backend: "claude", kind: "five_hour", used, ...(reset !== undefined && { resetsAt: sec(reset) }) });
const week = (at: number, used: number, reset?: number): LimitSample => ({ at, backend: "claude", kind: "seven_day", used, ...(reset !== undefined && { resetsAt: sec(reset) }) });

describe("weekEnd", () => {
  it("prefers the card's weekly reset, else the history's, rolled past now", () => {
    expect(weekEnd([], { sevenDay: { used: 1, resetsAt: sec(T0 + HOUR) } }, T0)).toBe(T0 + HOUR);
    expect(weekEnd([week(0, 1, T0 - HOUR)], {}, T0)).toBe(T0 - HOUR + WEEK);
    expect(weekEnd([week(0, 1)], { sevenDay: { used: 1 } }, T0)).toBeUndefined();
  });
});

describe("fiveHourLine", () => {
  it("starts full when the window opened and climbs down through its readings", () => {
    const reset = T0 + 3 * HOUR;
    expect(fiveHourLine([five(T0, 20, reset), five(T0 + HOUR, 50, reset)], T0 - WEEK, T0 + 2 * HOUR)).toEqual([
      [reset - FIVE_HOURS, 100],
      [T0, 80],
      [T0 + HOUR, 50],
    ]);
  });

  it("goes back to full at a reset and stays there until the next window opens", () => {
    const r1 = T0 + HOUR;
    const r2 = T0 + 8 * HOUR;
    expect(fiveHourLine([five(T0, 90, r1), five(T0 + 4 * HOUR, 10, r2)], T0 - WEEK, T0 + 5 * HOUR)).toEqual([
      [r1 - FIVE_HOURS, 100],
      [T0, 10],
      [r1, 10],
      [r1, 100],
      [r2 - FIVE_HOURS, 100],
      [T0 + 4 * HOUR, 90],
    ]);
  });

  it("ends full when the last window has already reset", () => {
    const r = T0 + HOUR;
    expect(fiveHourLine([five(T0, 40, r)], T0 - FIVE_HOURS + HOUR, T0 + 2 * HOUR)).toEqual([
      [T0 - FIVE_HOURS + HOUR, 100],
      [T0, 60],
      [r, 60],
      [r, 100],
      [T0 + 2 * HOUR, 100],
    ]);
  });

  it("joins readings with no reset, or one that moved earlier, as one line", () => {
    expect(fiveHourLine([five(T0, 10), five(T0 + HOUR, 20)], 0, T0 + HOUR)).toEqual([[T0, 90], [T0 + HOUR, 80]]);
    expect(fiveHourLine([five(T0, 10, T0 + 4 * HOUR), five(T0 + HOUR, 20, T0 + 2 * HOUR)], 0, T0 + HOUR)).toEqual([
      [T0 - HOUR, 100],
      [T0, 90],
      [T0 + HOUR, 80],
    ]);
  });
});

describe("hitMarks", () => {
  it("marks each window's first reading at 100%", () => {
    const rows = [five(1, 99, T0), five(2, 100, T0), five(3, 100, T0), week(4, 100, T0), five(5, 100, T0 + FIVE_HOURS)];
    expect(hitMarks(rows)).toEqual([{ at: 2, kind: "hit" }, { at: 4, kind: "hit" }, { at: 5, kind: "hit" }]);
  });
});

describe("resetMarks", () => {
  it("draws the week's end, the next reset, every 5 hours after it, and past resets", () => {
    const start = T0 - 10 * HOUR;
    const end = T0 + 12 * HOUR;
    const marks = resetMarks([five(T0 - 6 * HOUR, 5, T0 - 3 * HOUR), five(T0 - 3 * HOUR, 5, end + HOUR)], T0 + HOUR, start, end, T0, true);
    expect(marks).toEqual([
      { at: T0 - 3 * HOUR, kind: "light" },
      { at: T0 + HOUR, kind: "next" },
      { at: T0 + 6 * HOUR, kind: "light" },
      { at: T0 + 11 * HOUR, kind: "light" },
      { at: end, kind: "week" },
    ]);
  });

  it("drops a line within half an hour of one already drawn", () => {
    const end = T0 + 5 * HOUR + 10 * 60 * 1000;
    expect(resetMarks([], T0 + 10 * 60 * 1000, T0 - HOUR, end, T0, true)).toEqual([
      { at: T0 + 10 * 60 * 1000, kind: "next" },
      { at: end, kind: "week" },
    ]);
  });

  it("draws no next line when the 5-hour window already reset, and no week line when unknown", () => {
    expect(resetMarks([], T0 - HOUR, T0 - WEEK, T0 + HOUR, T0, false)).toEqual([]);
    expect(resetMarks([], undefined, T0 - WEEK, T0 + HOUR, T0, false)).toEqual([]);
  });
});

describe("burndown", () => {
  it("spans the current week, guesses a full start, and adds the card's latest readings", () => {
    const end = T0 + 2 * 24 * HOUR;
    const start = end - WEEK;
    const samples = [week(start + 24 * HOUR, 10, end), five(T0 - HOUR, 30, T0 + HOUR), week(start - HOUR, 90, start)];
    const chart = burndown(samples, { fiveHour: { used: 60, resetsAt: sec(T0 + HOUR) }, sevenDay: { used: 30, resetsAt: sec(end) } }, T0);
    expect([chart.start, chart.end, chart.now]).toEqual([start, end, T0]);
    expect(chart.weekly).toEqual([[start + 24 * HOUR, 90], [T0, 70]]);
    expect(chart.weeklyGuess).toEqual([[start, 100], [start + 24 * HOUR, 90]]);
    expect(chart.pace).toEqual([[start, 100], [end, 0]]);
    expect(chart.fiveHour).toEqual([[T0 + HOUR - FIVE_HOURS, 100], [T0 - HOUR, 70], [T0, 40]]);
    expect(chart.marks.filter((m) => m.kind === "next")).toEqual([{ at: T0 + HOUR, kind: "next" }]);
    expect(chart.marks.filter((m) => m.kind === "week")).toEqual([{ at: end, kind: "week" }]);
  });

  it("shows the last two days when the weekly reset is unknown, and marks a hit", () => {
    const chart = burndown([five(T0 - HOUR, 100, T0 + HOUR)], { fiveHour: { used: 100, resetsAt: sec(T0 + HOUR) } }, T0);
    expect([chart.start, chart.end]).toEqual([T0 - 48 * HOUR, T0 + FIVE_HOURS]);
    expect(chart.weekly).toEqual([]);
    expect(chart.weeklyGuess).toEqual([]);
    expect(chart.pace).toEqual([]);
    expect(chart.marks).toContainEqual({ at: T0 - HOUR, kind: "hit" });
  });

  it("needs no guess when the week's first reading is at its start", () => {
    const end = T0 + HOUR;
    const chart = burndown([week(end - WEEK, 0, end)], { sevenDay: { used: 0, resetsAt: sec(end) } }, T0);
    expect(chart.weeklyGuess).toEqual([]);
    expect(chart.weekly).toEqual([[end - WEEK, 100]]);
  });
});
