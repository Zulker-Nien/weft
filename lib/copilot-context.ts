import { basename } from "node:path";
import { firstLine } from "./format";
import type { Card, LimitWindow, Question } from "./types";

// What the copilot's chips are made from, tier 1: everything the cards themselves already say (lib/copilot-suggest.ts
// adds the cached reads and outside data from lib/copilot-sources.ts). Pure, so it is cheap to rebuild on every move.

const MAX_CARDS = 30;
const DAY = 86_400_000;
const HOUR = 3_600_000;

// Which cards matter most, lowest first: waiting on you, errored, finished and waiting in Review, running, Backlog.
export function urgency(c: Pick<Card, "column" | "error" | "pending">): number {
  if (c.column === "needs_you" || c.pending) return 0;
  if (c.error) return 1;
  if (c.column === "review") return 2;
  if (c.column === "running") return 3;
  return 4;
}

// "3h", "2d": a length of time.
export function span(ms: number): string {
  ms = Math.max(0, ms);
  if (ms < HOUR) return `${String(Math.max(1, Math.round(ms / 60_000)))}m`;
  if (ms < DAY) return `${String(Math.round(ms / HOUR))}h`;
  return `${String(Math.round(ms / DAY))}d`;
}

// How long ago `at` was.
export const ago = (at: number | undefined, now: number) => (at ? span(now - at) : undefined);

// A question with every option's meaning, so a chip can say "Pick Option A, GitHub only" rather than "Pick Option A".
export function questionText(q: Question): string {
  const options = q.options.map((o) => (o.description ? `"${o.label}" (${firstLine(o.description, 90)})` : `"${o.label}"`));
  return `${firstLine(q.question, 120)} Options: ${options.join("; ")}`;
}

type Live = Card & { role?: undefined };
const openCards = (cards: readonly Card[]) =>
  cards.filter((c): c is Live => c.role !== "copilot" && !c.archived && c.column !== "done");

// One block per open card, most urgent first: id, column and how long it has sat there, project, title, stage, what's
// left, the latest reply, the full open question, the error and a rate-limit hit.
export function cardLines(cards: readonly Card[], now: number): string[] {
  return [...openCards(cards)]
    .sort((a, b) => urgency(a) - urgency(b) || (a.columnAt ?? a.updatedAt) - (b.columnAt ?? b.updatedAt))
    .slice(0, MAX_CARDS)
    .map((c) => {
      const since = ago(c.columnAt ?? c.lastActivity, now);
      const head = [`[${c.column}${since ? ` for ${since}` : ""}]`, basename(c.cwd), `"${firstLine(c.title, 70)}"`, `(id ${c.id})`];
      if (c.stage) head.push(`stage ${c.stage}`);
      if (c.remaining && c.remaining !== "none") head.push(`left: ${firstLine(c.remaining, 80)}`);
      const lines = [`- ${head.join(" · ")}`];
      if (c.lastLine) lines.push(`  last reply: ${firstLine(c.lastLine, 160)}`);
      if (c.suggestion) lines.push(`  suggested next message: ${firstLine(c.suggestion, 120)}`);
      if (c.pending?.questions?.length) for (const q of c.pending.questions) lines.push(`  asks: ${questionText(q)}`);
      else if (c.pending) lines.push(`  asks permission: ${firstLine(c.pending.title, 120)}`);
      if (c.error) lines.push(`  error: ${firstLine(c.error, 160)}`);
      if (c.rateLimitHit) lines.push("  stopped by the plan's rate limit");
      return lines.join("\n");
    });
}

// Cards finished in the last day, newest first.
export function recentDone(cards: readonly Card[], now: number): string[] {
  return cards
    .filter((c) => c.role !== "copilot" && c.column === "done" && (c.columnAt ?? 0) > now - DAY)
    .sort((a, b) => (b.columnAt ?? 0) - (a.columnAt ?? 0))
    .slice(0, 10)
    .map((c) => `- ${basename(c.cwd)} · "${firstLine(c.title, 70)}" (${ago(c.columnAt, now) ?? "today"} ago)`);
}

// Open cards editing the same file: they can clash, since every card shares one working tree.
export function overlaps(cards: readonly Card[]): string[] {
  const byFile = new Map<string, Live[]>();
  for (const c of openCards(cards)) for (const f of c.touchedFiles ?? []) byFile.set(f, [...(byFile.get(f) ?? []), c]);
  return [...byFile]
    .filter(([, cs]) => cs.length > 1)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5)
    .map(([f, cs]) => `- ${basename(f)}: ${cs.map((c) => `"${firstLine(c.title, 40)}" (id ${c.id})`).join(", ")}`);
}

const windowText = (name: string, w: LimitWindow | undefined, now: number) => {
  if (!w) return undefined;
  const reset = w.resetsAt ? `, resets in ${span(w.resetsAt * 1000 - now)}` : "";
  return `${name} ${String(Math.round(w.used))}% used${reset}`;
};

// Today's spend and the plan's limits, from the card that last reported them.
export function spend(cards: readonly Card[], now: number): string[] {
  const today = cards.filter((c) => (c.lastActivity ?? 0) > now - DAY).reduce((sum, c) => sum + (c.costUsd ?? 0), 0);
  const latest = [...cards].filter((c) => c.stats?.fiveHour || c.stats?.sevenDay).sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0))[0];
  const limits = [windowText("5-hour window", latest?.stats?.fiveHour, now), windowText("weekly", latest?.stats?.sevenDay, now)].filter(Boolean);
  const lines = today > 0 ? [`- $${today.toFixed(2)} spent on cards active in the last day`] : [];
  if (limits.length) lines.push(`- plan limits: ${limits.join("; ")}`);
  return lines;
}

// "Friday 21:54": the clock, so late at night a chip can suggest wrapping up.
export function clock(now: number): string {
  const d = new Date(now);
  return `${d.toLocaleDateString("en-US", { weekday: "long" })} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
