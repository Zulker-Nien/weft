import type { Card, ScheduledMessage } from "./types";

// Sent this long after the 5-hour window resets, so the message lands in the new window.
export const RESET_GRACE_MS = 60_000;

// When the plan's 5-hour window resets (unix ms), if a Claude thread has seen one that's still ahead.
// Every future reset is the same window's, so the latest one is the safest to trust.
export function nextFiveHourReset(cards: Card[], now = Date.now()): number | undefined {
  let best: number | undefined;
  for (const card of cards) {
    if (card.backend !== "claude") continue;
    const resetsAt = card.stats?.fiveHour?.resetsAt;
    if (!resetsAt) continue;
    const at = resetsAt * 1000;
    if (at > now && (best === undefined || at > best)) best = at;
  }
  return best;
}

export interface SendLaterOption {
  label: string;
  at: number;
}

// The times the reply box offers, the default first: the next 5-hour reset on a Claude thread
// (puku has no plan limit), then an hour from now, then tomorrow morning.
export function sendLaterOptions(backend: Card["backend"], reset: number | undefined, now = Date.now()): SendLaterOption[] {
  const options: SendLaterOption[] = [];
  if (backend === "claude" && reset) options.push({ label: "At the 5-hour reset", at: reset + RESET_GRACE_MS });
  options.push({ label: "In 1 hour", at: now + 3600_000 });
  const morning = new Date(now);
  morning.setDate(morning.getDate() + 1);
  morning.setHours(9, 0, 0, 0);
  options.push({ label: "Tomorrow morning", at: morning.getTime() });
  return options;
}

// The card's scheduled messages with this one added, soonest first.
export function addScheduled(list: ScheduledMessage[] | undefined, message: ScheduledMessage): ScheduledMessage[] {
  return [...(list ?? []), message].sort((a, b) => a.at - b.at);
}

// The message whose time has come, if any (the soonest).
export function dueMessage(card: Card, now = Date.now()): ScheduledMessage | undefined {
  const first = card.scheduled?.[0];
  return first && first.at <= now ? first : undefined;
}

// "11:41pm", or "sat 9:00am" when it isn't today.
export function formatAt(at: number, now = Date.now()) {
  const d = new Date(at);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(" ", "").toLowerCase();
  const today = d.toDateString() === new Date(now).toDateString();
  return today ? time : `${d.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase()} ${time}`;
}

// The value a datetime-local input wants for a time: "2026-10-10T23:41", in local time.
export function toLocalInput(at: number) {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
