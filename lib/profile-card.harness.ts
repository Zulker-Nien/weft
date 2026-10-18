// Fixtures for lib/profile-card*.test.ts: a full GameState and a gh profile.
import type { GameState } from "./game-server";
import type { GithubProfile } from "./github-profile";

export function game(over: Partial<GameState> = {}): GameState {
  return {
    name: "Ada",
    xp: 120,
    level: { level: 2, title: "Thread", floor: 40, next: 160 },
    weekXp: 30,
    weekShipped: 1,
    totals: { started: 10, shipped: 6 },
    streak: { current: 4, best: 9, freezes: 1, frozen: [], atRisk: false, reached: {} },
    today: { cards: 2, turns: 3, done: 1, xp: 17 },
    cloth: [
      { day: "2026-10-10", xp: 5, tone: 1 },
      { day: "2026-10-11", xp: 17, tone: 4 },
    ],
    usage: [
      { day: "2026-10-10", input: 0, output: 0, fiveHour: 0, sevenDay: 0 },
      { day: "2026-10-11", input: 1_200_000, output: 300_000, fiveHour: 1, sevenDay: 1 },
    ],
    limitHits: { fiveHour: 3, sevenDay: 1 },
    records: { biggestDay: { day: "2026-10-09", cards: 9 }, mostShipped: { day: "2026-10-08", done: 4 }, maxRunning: 2, fastest: 5 * 60_000, cheapest: null },
    attributes: [{ id: "follow", icon: "🎯", label: "Follow-through", value: 80, hint: "8 of 10" }],
    className: "Finisher",
    skills: [{ tech: "Next.js", xp: 100, level: 3 }],
    badges: [
      { id: "first-card", icon: "🧵", name: "First thread", desc: "Start a card", group: "Milestones", unlocked: true, at: 1 },
      { id: "guarded", icon: "🛡️", name: "Guarded", desc: "Hooks and CI", group: "Code health", unlocked: false, fix: { check: "guarded" } },
      { id: "faster", icon: "⚡", name: "Faster", desc: "Shipped in <5m", group: "Habits", unlocked: true, at: 5 },
    ],
    projects: [],
    inView: null,
    leagues: ["Cotton"],
    ...over,
  };
}

export function gh(over: Partial<GithubProfile> = {}): GithubProfile {
  return {
    login: "alex",
    name: "Alex",
    bio: "Hello",
    avatarUrl: "https://a/1.png",
    url: "https://github.com/alex",
    company: "@co",
    location: "Berlin",
    blog: "https://example.com/",
    followers: 12,
    publicRepos: 3,
    ...over,
  };
}
