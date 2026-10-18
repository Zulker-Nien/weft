// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameState } from "@/lib/game-server";
import type { ProjectReport } from "@/lib/project-badges";
import GameBadge from "./GameBadge";
import "./test-utils";

const project: ProjectReport = { root: "/dev/app", name: "app", stack: ["Next.js"], ok: { readme: true }, score: 70, coverage: 50, perfect: false, clean: true };

function game(over: Partial<GameState> = {}): GameState {
  return {
    name: "Ada",
    xp: 120,
    level: { level: 2, title: "Thread", floor: 40, next: 160 },
    weekXp: 30,
    weekShipped: 1,
    streak: { current: 4, best: 9, freezes: 1, frozen: [], atRisk: false, reached: {} },
    today: { cards: 2, turns: 3, done: 1, xp: 17 },
    cloth: [{ day: "2026-10-11", xp: 17, tone: 4 }],
    usage: [
      { day: "2026-10-10", input: 0, output: 0, fiveHour: 0, sevenDay: 0 },
      { day: "2026-10-11", input: 1_200_000, output: 300_000, fiveHour: 1, sevenDay: 1 },
    ],
    limitHits: { fiveHour: 3, sevenDay: 1 },
    records: { biggestDay: { day: "2026-10-09", cards: 9 }, mostShipped: null, maxRunning: 2, fastest: 5 * 60_000, cheapest: null },
    attributes: [{ id: "follow", icon: "🎯", label: "Follow-through", value: 80, hint: "8 of 10" }],
    className: "Finisher",
    skills: [{ tech: "Next.js", xp: 100, level: 3 }],
    badges: [
      { id: "first-card", icon: "🧵", name: "First thread", desc: "Start a card", group: "Milestones", unlocked: true, at: 1 },
      { id: "guarded", icon: "🛡️", name: "Guarded", desc: "Hooks and CI", group: "Code health", unlocked: false, fix: { check: "guarded" } },
    ],
    projects: [project],
    inView: "/dev/app",
    leagues: ["Cotton", "Linen"],
    ...over,
  };
}

let state = game();
beforeEach(() => {
  state = game();
  localStorage.clear();
  document.cookie = "weft-show-progress=; path=/; max-age=0";
  // The You tab's My mini apps asks /api/apps; everything else here is the game.
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(url.startsWith("/api/apps") ? { apps: [] } : { game: state })))));
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const onStart = vi.fn();
  const onToast = vi.fn();
  const view = render(<GameBadge cwd="/dev/app" refresh={1} onStart={onStart} onToast={onToast} />);
  return { onStart, onToast, view };
}

describe("GameBadge", () => {
  it("shows the streak and level, and stays quiet the first time", async () => {
    const { onToast } = setup();
    expect(await screen.findByRole("button", { name: "Your loom: 4-day streak, level 2" })).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(localStorage.getItem("weft-game-announced") ?? "{}")).toEqual({ badges: ["first-card"], level: 2 }));
    expect(onToast).not.toHaveBeenCalled();
  });

  it("toasts a badge earned since last time", async () => {
    localStorage.setItem("weft-game-announced", JSON.stringify({ badges: [], level: 2 }));
    const { onToast } = setup();
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("🏅 Badge unlocked: 🧵 First thread"));
  });

  it("hides in quiet mode", async () => {
    document.cookie = "weft-show-progress=0; path=/";
    setup();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: /Your loom/ })).toBeNull();
  });

  it("opens the loom, walks its tabs and starts a card from Set it up", async () => {
    const { onStart } = setup();
    await userEvent.click(await screen.findByRole("button", { name: /Your loom/ }));
    expect(await screen.findByText("Finisher")).toBeInTheDocument();
    expect(screen.getByText("5 min")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Badges/ }));
    expect(screen.getByText("First thread")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Set it up" }));
    expect(onStart).toHaveBeenCalledWith("/dev/app", expect.stringContaining("pre-commit hook"), "Guarded for app");
  });

  it("shows each project's tree and the locked league ladder", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: /Your loom/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Projects" }));
    expect(screen.getByText("README")).toBeInTheDocument();
    expect(screen.getByText(/50% lines covered/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "League" }));
    expect(screen.getByText("🔒 Linen")).toBeInTheDocument();
    expect(screen.getByText("30 XP")).toBeInTheDocument();
  });
});
