import os from "node:os";
import path from "node:path";
import { backfillEvents } from "./activity";
import { activeDays, dayKey, levelFor, streakOf, tallyDays, type Level } from "./game";
import { attributes, classFor, type Attribute } from "./game-attributes";
import type { Card } from "./types";
import { isScratch } from "./welcome";

// What the welcome shows before anything is imported: a Wefter Profile worked out from the sessions
// the sync would pick up (screen 1), and their projects to tick (screen 2). Pure, so it's tested
// without Claude Code; app/api/welcome feeds it lib/import-sync.ts sessionsToImport().

export interface WelcomeProject {
  cwd: string;
  // The folder's name, and where it is with ~ for your home folder.
  name: string;
  where: string;
  sessions: number;
  last: number;
  // A worktree, scratch or temp folder: shown folded and unticked.
  scratch: boolean;
}

export interface WelcomeProfile {
  className: string;
  level: Level;
  xp: number;
  sessions: number;
  shipped: number;
  bestStreak: number;
  projects: number;
  // Your three strongest attributes.
  top: Attribute[];
}

export function welcomeProjects(cards: Card[]): WelcomeProject[] {
  const home = os.homedir();
  const byCwd = new Map<string, WelcomeProject>();
  for (const card of cards) {
    const last = card.lastActivity ?? card.createdAt;
    const known = byCwd.get(card.cwd);
    if (known) {
      known.sessions += 1;
      known.last = Math.max(known.last, last);
      continue;
    }
    const where = card.cwd === home ? "~" : card.cwd.startsWith(`${home}/`) ? `~${card.cwd.slice(home.length)}` : card.cwd;
    byCwd.set(card.cwd, { cwd: card.cwd, name: path.basename(card.cwd) || card.cwd, where, sessions: 1, last, scratch: isScratch(card.cwd) });
  }
  return [...byCwd.values()].sort((a, b) => b.sessions - a.sessions || b.last - a.last);
}

// The profile these cards would give you, as lib/game-server.ts works it out, minus what needs
// measuring a project (code health, stacks, craft from transcripts).
export function welcomeProfile(cards: Card[], now = Date.now()): WelcomeProfile {
  const events = backfillEvents(cards);
  const days = tallyDays(events, (cwd) => cwd);
  const today = dayKey(now);
  const streak = streakOf(activeDays(days), today);
  const perCwd = new Map<string, number>();
  for (const c of cards) perCwd.set(c.cwd, (perCwd.get(c.cwd) ?? 0) + 1);
  const busy = [...perCwd.values()].filter((n) => n >= 3).length;
  const attrs = attributes({ events, days, today, bestStreak: streak.best, projects: [], projectCount: busy, stacks: 0, habits: new Map() });
  const xp = [...days.values()].reduce((n, d) => n + d.xp, 0);
  return {
    className: classFor(attrs),
    level: levelFor(xp),
    xp,
    sessions: cards.length,
    shipped: cards.filter((c) => c.column === "done").length,
    bestStreak: streak.best,
    projects: perCwd.size,
    top: [...attrs].sort((a, b) => b.value - a.value).slice(0, 3),
  };
}

// Both screens' data: the profile counts only the projects ticked by default (not scratch folders).
export function welcomePreview(cards: Card[], now = Date.now()) {
  const projects = welcomeProjects(cards);
  const ticked = new Set(projects.filter((p) => !p.scratch).map((p) => p.cwd));
  return { projects, profile: welcomeProfile(cards.filter((c) => ticked.has(c.cwd)), now) };
}
