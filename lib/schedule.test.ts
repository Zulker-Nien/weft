import { describe, expect, it } from "vitest";
import { RESET_GRACE_MS, addScheduled, dueMessage, formatAt, nextFiveHourReset, sendLaterOptions, toLocalInput } from "./schedule";
import type { Card } from "./types";

const NOW = new Date(2026, 9, 10, 22, 30).getTime();

const card = (over: Partial<Card> = {}): Card =>
  ({ id: "c", title: "t", prompt: "", cwd: "/tmp", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, ...over }) as Card;

const withReset = (at: number, over: Partial<Card> = {}) => card({ stats: { fiveHour: { used: 90, resetsAt: at / 1000 } }, ...over });

describe("nextFiveHourReset", () => {
  it("is undefined when no thread has seen a reset", () => {
    expect(nextFiveHourReset([card(), card({ stats: {} })], NOW)).toBeUndefined();
  });

  it("ignores resets already past", () => {
    expect(nextFiveHourReset([withReset(NOW - 60_000)], NOW)).toBeUndefined();
  });

  it("takes the latest reset still ahead", () => {
    const soon = NOW + 3600_000;
    const later = NOW + 2 * 3600_000;
    expect(nextFiveHourReset([withReset(soon), withReset(later), withReset(NOW - 1)], NOW)).toBe(later);
  });

  it("skips puku threads", () => {
    expect(nextFiveHourReset([withReset(NOW + 3600_000, { backend: "puku" })], NOW)).toBeUndefined();
  });
});

describe("sendLaterOptions", () => {
  it("puts the 5-hour reset first on a Claude thread, a minute after it", () => {
    const reset = NOW + 3600_000;
    const [first] = sendLaterOptions("claude", reset, NOW);
    expect(first).toEqual({ label: "At the 5-hour reset", at: reset + RESET_GRACE_MS });
  });

  it("leaves the reset out on puku, or when it isn't known", () => {
    expect(sendLaterOptions("puku", NOW + 3600_000, NOW).map((o) => o.label)).toEqual(["In 1 hour", "Tomorrow morning"]);
    expect(sendLaterOptions("claude", undefined, NOW)[0].label).toBe("In 1 hour");
  });

  it("offers tomorrow at 9am", () => {
    const tomorrow = sendLaterOptions("claude", undefined, NOW)[1];
    expect(new Date(tomorrow.at)).toEqual(new Date(2026, 9, 11, 9, 0));
  });
});

describe("addScheduled and dueMessage", () => {
  it("keeps the soonest first", () => {
    const list = addScheduled([{ id: "b", text: "b", at: NOW + 2 }], { id: "a", text: "a", at: NOW + 1 });
    expect(list.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("finds the message whose time has come", () => {
    const scheduled = [{ id: "a", text: "hi", at: NOW }];
    expect(dueMessage(card({ scheduled }), NOW - 1)).toBeUndefined();
    expect(dueMessage(card({ scheduled }), NOW)?.id).toBe("a");
    expect(dueMessage(card(), NOW)).toBeUndefined();
  });
});

describe("formatAt and toLocalInput", () => {
  it("shows just the time today, the weekday otherwise", () => {
    expect(formatAt(new Date(2026, 9, 10, 23, 41).getTime(), NOW)).toBe("11:41pm");
    expect(formatAt(new Date(2026, 9, 11, 9, 0).getTime(), NOW)).toBe("sun 9:00am");
  });

  it("writes a datetime-local value", () => {
    expect(toLocalInput(new Date(2026, 0, 2, 3, 4).getTime())).toBe("2026-01-02T03:04");
  });
});
