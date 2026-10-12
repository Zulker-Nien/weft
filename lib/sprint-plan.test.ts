import { describe, expect, it } from "vitest";
import { mapBacklog, sprintPrompt } from "./sprint-plan";
import { SHOW_DIR } from "./show-dir";
import type { Card } from "./types";

function card(id: string, over: Partial<Card> = {}): Card {
  return { id, title: `Card ${id}`, prompt: "", cwd: "/dev/app", backend: "claude", permissionMode: "default", column: "backlog", createdAt: 0, updatedAt: 0, ...over };
}

const DAY = 86_400_000;

describe("mapBacklog", () => {
  it("splits the repo's open cards into Backlog, oldest first, and the cards at work", () => {
    const cards = [
      card("new", { createdAt: 2 }),
      card("old", { createdAt: 1, cwd: "/dev/app/web" }),
      card("run", { column: "running" }),
      card("rev", { column: "review" }),
      card("gone", { archived: true }),
      card("done", { column: "done" }),
      card("pilot", { role: "copilot" }),
      card("else", { cwd: "/dev/other" }),
    ];
    const map = mapBacklog(cards, "/dev/app");
    expect(map.backlog.map((c) => c.id)).toEqual(["old", "new"]);
    expect(map.active.map((c) => c.id)).toEqual(["run", "rev"]);
  });
});

describe("sprintPrompt", () => {
  const base = { root: "/dev/app", origin: "http://localhost:3000", now: 3 * DAY };

  it("lists each Backlog card's ask, the cards at work and their files, and how to start a sprint", () => {
    const prompt = sprintPrompt({
      ...base,
      map: {
        backlog: [
          card("a", { title: "Dark mode", prompt: "Add a dark\n\n  theme   toggle", tags: ["ui", "launch"] }),
          card("b", { createdAt: 2 * DAY, prompt: "x".repeat(800) }),
          card("c", { createdAt: 3 * DAY }),
        ],
        active: [
          card("r", {
            column: "running",
            stage: "First shot",
            remaining: "tests",
            touchedFiles: ["/dev/app/a.ts", "/elsewhere/x.ts", "/dev/app", ...Array.from({ length: 9 }, (_, i) => `/dev/app/f${i}.ts`)],
          }),
          card("v", { column: "review" }),
          card("n", { column: "needs_you", touchedFiles: ["/dev/app/b.ts"] }),
        ],
      },
    });
    expect(prompt).toContain("Plan the Backlog of /dev/app into sprints: 3 cards wait there.");
    expect(prompt).toContain("Don't edit any file in the project");
    expect(prompt).toContain('1. "Dark mode" (card a, added 3d ago, tagged ui, launch)\n   asks: Add a dark theme toggle\n');
    expect(prompt).toContain(`2. "Card b" (card b, added 1d ago)\n   asks: ${"x".repeat(699)}…\n`);
    expect(prompt).toContain('3. "Card c" (card c, added just now)\n   asks: (no prompt)');
    expect(prompt).toContain('- "Card r" (card r, running; stage First shot; remaining: tests): a.ts, f0.ts, f1.ts, f2.ts, f3.ts, f4.ts, f5.ts, f6.ts, +2 more');
    expect(prompt).toContain('- "Card v" (card v, review): no files touched yet');
    expect(prompt).toContain('- "Card n" (card n, needs_you): b.ts\n');
    expect(prompt).toContain(`${SHOW_DIR}/sprint-app/index.html`);
    expect(prompt).toContain("weft://reply?text=<url-encoded message>");
    expect(prompt).toContain(`curl -s -X PATCH http://localhost:3000/api/cards/<card id> -H 'x-threadboard: 1' -H 'content-type: application/json' -d '{"column":"running"}'`);
    expect(prompt).toContain(`"cwd":"/dev/app"`);
    expect(prompt).toContain(`-d '{"archived":true}'`);
  });

  it("says one card in the singular and leaves out the at-work list when nothing is", () => {
    const prompt = sprintPrompt({ ...base, map: { backlog: [card("a")], active: [] } });
    expect(prompt).toContain("1 card wait there");
    expect(prompt).not.toContain("Already at work");
  });
});
