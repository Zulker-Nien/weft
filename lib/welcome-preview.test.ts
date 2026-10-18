import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

// lib/welcome-preview.ts: the profile the welcome shows before the sync runs, worked out from the
// cards the sync would bring in. isScratch comes from lib/welcome, here checked just at home.

vi.mock("./welcome", () => ({ isScratch: (cwd: string) => cwd.startsWith(path.join(os.tmpdir(), "x")) }));

const home = os.homedir();

function card(over: Partial<Card> = {}): Card {
  return {
    id: "c",
    title: "t",
    prompt: "",
    cwd: "/repo",
    backend: "claude",
    permissionMode: "default",
    column: "review",
    createdAt: 1_000,
    updatedAt: 1_000,
    ...over,
  };
}

const { welcomeProjects, welcomeProfile, welcomePreview } = await import("./welcome-preview");

const NOW = new Date(2026, 9, 11, 12).getTime();

describe("welcomeProjects", () => {
  it("groups cards by cwd, sums sessions, takes the latest activity, and names the folder", () => {
    const projects = welcomeProjects([
      card({ id: "1", cwd: "/repo/a", createdAt: 10, lastActivity: 20 }),
      card({ id: "2", cwd: "/repo/a", createdAt: 5, lastActivity: 50 }),
      card({ id: "3", cwd: "/repo/b", createdAt: 100, lastActivity: 100 }),
    ]);
    const a = projects.find((p) => p.cwd === "/repo/a")!;
    expect(a).toMatchObject({ name: "a", sessions: 2, last: 50 });
    expect(projects[0]?.sessions).toBe(2);
  });

  it("uses the cwd itself as the name when the path has no basename", () => {
    const [p] = welcomeProjects([card({ cwd: "/" })]);
    expect(p?.name).toBe("/");
  });

  it("shortens paths inside the home folder with a leading ~", () => {
    const homeChild = path.join(home, "dev", "app");
    const [p] = welcomeProjects([card({ cwd: homeChild })]);
    expect(p?.where).toBe("~/dev/app");
  });

  it("uses ~ for the home directory itself", () => {
    const [p] = welcomeProjects([card({ cwd: home })]);
    expect(p?.where).toBe("~");
  });

  it("leaves a cwd outside home as itself", () => {
    const cwd = "/tmp/something";
    const [p] = welcomeProjects([card({ cwd })]);
    expect(p?.where).toBe(cwd);
  });

  it("orders by most sessions, then most recent", () => {
    const a = card({ id: "1", cwd: "/repo/a", createdAt: 1 });
    const b = card({ id: "2", cwd: "/repo/b", createdAt: 5 });
    const a2 = card({ id: "3", cwd: "/repo/a", createdAt: 2 });
    const projects = welcomeProjects([a, b, a2]);
    expect(projects.map((p) => p.cwd)).toEqual(["/repo/a", "/repo/b"]);
  });

  it("flags a scratch cwd using isScratch", () => {
    const projects = welcomeProjects([
      card({ id: "1", cwd: "/repo/real" }),
      card({ id: "2", cwd: path.join(os.tmpdir(), "x", "worktree") }),
    ]);
    expect(projects.find((p) => p.cwd === "/repo/real")?.scratch).toBe(false);
    expect(projects.find((p) => p.cwd.startsWith(path.join(os.tmpdir(), "x")))?.scratch).toBe(true);
  });

  it("uses lastActivity over createdAt when both are set", () => {
    const [p] = welcomeProjects([
      card({ id: "1", cwd: "/a", createdAt: 10, lastActivity: 99 }),
    ]);
    expect(p?.last).toBe(99);
  });
});

describe("welcomeProfile", () => {
  it("returns zero work for an empty card list", () => {
    const profile = welcomeProfile([], NOW);
    expect(profile.sessions).toBe(0);
    expect(profile.shipped).toBe(0);
    expect(profile.projects).toBe(0);
    expect(profile.xp).toBe(0);
    expect(profile.className).toEqual(expect.any(String));
    expect(profile.level).toMatchObject({ level: expect.any(Number) as unknown });
    // Three attributes even when nothing happened yet.
    expect(profile.top).toHaveLength(3);
    expect(profile.top.every((a) => a.value === 0)).toBe(true);
  });

  it("counts a shipped card for the shipped number and skips copilots", () => {
    const profile = welcomeProfile([
      card({ id: "1", column: "done" }),
      card({ id: "2", column: "review" }),
      card({ id: "c", column: "review", role: "copilot" }),
    ]);
    expect(profile.sessions).toBe(3);
    expect(profile.shipped).toBe(1);
  });

  it("sets top to the three strongest attributes", () => {
    const profile = welcomeProfile([
      card({ id: "1", createdAt: NOW - 60_000 }),
      card({ id: "2", createdAt: NOW - 60_000 }),
      card({ id: "3", createdAt: NOW - 60_000 }),
    ]);
    expect(profile.top).toHaveLength(3);
    const values = profile.top.map((a) => a.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });
});

describe("welcomePreview", () => {
  it("shows every project but only counts the non-scratch ones in the profile", () => {
    const cards = [
      card({ id: "1", cwd: "/repo/real", createdAt: NOW - 60_000 }),
      card({ id: "2", cwd: "/repo/real", createdAt: NOW - 60_000 }),
      card({ id: "3", cwd: path.join(os.tmpdir(), "x", "worktree"), createdAt: NOW - 60_000 }),
    ];
    const preview = welcomePreview(cards, NOW);
    expect(preview.projects).toHaveLength(2);
    expect(preview.projects.find((p) => p.scratch)?.cwd).toContain("worktree");
    // Profile counts only the real project (scratch row ticked false would not survive).
    expect(preview.profile.sessions).toBe(2);
  });

  it("returns an empty list and a zero profile when no cards are passed in", () => {
    expect(welcomePreview([], NOW).projects).toEqual([]);
    expect(welcomePreview([], NOW).profile.sessions).toBe(0);
  });
});
