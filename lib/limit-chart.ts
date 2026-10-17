import type { Backend, CardStats } from "./types";

// The status strip's burndown chart (components/LimitBurndown.tsx), worked out from the limit history
// (lib/limit-history.ts): what's left of the weekly and 5-hour limits across the current week, where
// either was hit, and where the 5-hour windows and the week reset. Pure: times in unix ms, shares 0-100.

export type LimitKind = "five_hour" | "seven_day";

// One reading: when (unix ms), which CLI and window, the share used (0-100) and its reset (unix seconds).
export interface LimitSample {
  at: number;
  backend: Backend;
  kind: LimitKind;
  used: number;
  resetsAt?: number;
}

export const HOUR = 60 * 60 * 1000;
export const FIVE_HOURS = 5 * HOUR;
export const WEEK = 7 * 24 * HOUR;

// [time, share left].
export type Point = [number, number];

// A vertical line: a 5-hour reset (light), the next one (strong), the weekly reset, or a hit.
export type MarkKind = "light" | "next" | "week" | "hit";

export interface Mark {
  at: number;
  kind: MarkKind;
}

export interface Burndown {
  start: number;
  end: number;
  now: number;
  weekly: Point[];
  // From the week's start to the first reading: the week starts full, the readings start later.
  weeklyGuess: Point[];
  fiveHour: Point[];
  // An even burn from full at the week's start to empty at its reset.
  pace: Point[];
  marks: Mark[];
}

const left = (used: number) => Math.max(0, Math.min(100, 100 - used));
const ms = (resetsAt?: number) => (resetsAt === undefined ? undefined : resetsAt * 1000);

// The weekly reset after now: the latest one known, rolled on a week at a time when it has passed.
export function weekEnd(samples: LimitSample[], stats: CardStats, now: number): number | undefined {
  let end = ms(stats.sevenDay?.resetsAt) ?? ms(samples.findLast((s) => s.kind === "seven_day" && s.resetsAt)?.resetsAt);
  if (end === undefined) return undefined;
  while (end <= now) end += WEEK;
  return end;
}

// The readings of one window, with the card's current one last when it adds anything.
function readings(samples: LimitSample[], kind: LimitKind, current: CardStats["fiveHour"], start: number, now: number) {
  const out = samples.filter((s) => s.kind === kind && s.at >= start && s.at <= now);
  const last = out.at(-1);
  if (current && (!last || last.used !== current.used || last.resetsAt !== current.resetsAt)) {
    out.push({ at: now, backend: last?.backend ?? "claude", kind, used: current.used, resetsAt: current.resetsAt });
  }
  return out;
}

// The 5-hour line: each window's readings, back to full at its reset, flat until the next window starts.
export function fiveHourLine(rows: LimitSample[], start: number, now: number): Point[] {
  const out: Point[] = [];
  let reset: number | undefined;
  let last = 100;
  const resetTo = (r: number) => out.push([r, last], [r, 100]);
  for (const s of rows) {
    const r = ms(s.resetsAt);
    const opened = r === undefined ? undefined : Math.max(start, r - FIVE_HOURS);
    if (reset !== undefined && r !== reset && reset <= s.at) {
      resetTo(reset);
      if (opened !== undefined && opened > reset && opened < s.at) out.push([opened, 100]);
    } else if (!out.length && opened !== undefined && opened < s.at) {
      out.push([opened, 100]);
    }
    last = left(s.used);
    out.push([s.at, last]);
    reset = r ?? reset;
  }
  if (reset !== undefined && reset <= now) {
    resetTo(reset);
    out.push([now, 100]);
  }
  return out;
}

// Where a window ran out: its first reading at 100% used.
export function hitMarks(rows: LimitSample[]): Mark[] {
  const seen = new Set<string>();
  const out: Mark[] = [];
  for (const s of rows) {
    const id = `${s.kind}:${s.resetsAt ?? ""}`;
    if (s.used < 100 || seen.has(id)) continue;
    seen.add(id);
    out.push({ at: s.at, kind: "hit" });
  }
  return out;
}

// The green lines: every past 5-hour reset the history saw, the next one, every 5 hours after it to
// the week's end, and the week's end itself.
export function resetMarks(rows: LimitSample[], next: number | undefined, start: number, end: number, now: number, weekly: boolean): Mark[] {
  const out: Mark[] = [];
  const add = (at: number, kind: MarkKind) => {
    if (at < start || at > end || out.some((m) => Math.abs(m.at - at) < 30 * 60 * 1000)) return;
    out.push({ at, kind });
  };
  if (weekly) add(end, "week");
  if (next !== undefined && next > now) {
    add(next, "next");
    for (let at = next + FIVE_HOURS; at < end; at += FIVE_HOURS) add(at, "light");
  }
  for (const s of rows) {
    const r = ms(s.resetsAt);
    if (r !== undefined && r <= now) add(r, "light");
  }
  return out.sort((a, b) => a.at - b.at);
}

// The whole chart for one CLI's history and its latest windows.
export function burndown(samples: LimitSample[], stats: CardStats, now: number): Burndown {
  const known = weekEnd(samples, stats, now);
  const end = known ?? now + FIVE_HOURS;
  const start = known === undefined ? now - 2 * 24 * HOUR : end - WEEK;
  const week = readings(samples, "seven_day", stats.sevenDay, start, now);
  const five = readings(samples, "five_hour", stats.fiveHour, start, now);
  const weekly = week.map((s): Point => [s.at, left(s.used)]);
  const first = weekly.at(0);
  const weeklyGuess: Point[] = known !== undefined && first && first[0] > start ? [[start, 100], first] : [];
  const next = ms(stats.fiveHour?.resetsAt) ?? ms(five.at(-1)?.resetsAt);
  const marks = [...resetMarks(five, next, start, end, now, known !== undefined), ...hitMarks([...week, ...five])];
  return {
    start,
    end,
    now,
    weekly,
    weeklyGuess,
    fiveHour: fiveHourLine(five, start, now),
    pace: known === undefined ? [] : [[start, 100], [end, 0]],
    marks,
  };
}
