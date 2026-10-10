import { describe, expect, it } from "vitest";
import { cardMenu, columnMenu, resumeCommand, type MenuItem } from "./card-menu";
import type { Card } from "./types";

function card(over: Partial<Card> = {}): Card {
  return { id: "c1", title: "T", prompt: "p", cwd: "/w", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, ...over } as Card;
}

const ids = (items: MenuItem[]) => items.flatMap((i) => ("id" in i ? [i.id] : []));
const item = (items: MenuItem[], id: string) => items.find((i) => "id" in i && i.id === id) as { enabled?: boolean; label: string } | undefined;

describe("cardMenu", () => {
  it("offers every move except the card's own column, flat", () => {
    const m = ids(cardMenu(card({ column: "review" })));
    expect(m).toContain("move:done");
    expect(m).toContain("move:backlog");
    expect(m).not.toContain("move:review");
    expect(m).not.toContain("start");
  });

  it("offers Start Now in Backlog", () => {
    expect(ids(cardMenu(card({ column: "backlog" })))).toContain("start");
  });

  it("disables moves and skills while a turn runs, and offers Stop", () => {
    const m = cardMenu(card({ column: "running" }));
    expect(ids(m)).toContain("stop");
    expect(item(m, "move:done")?.enabled).toBe(false);
    expect(item(m, "skill:weft:done")?.enabled).toBe(false);
    expect(ids(cardMenu(card()))).not.toContain("stop");
  });

  it("shows dev server items only when the review plan names one", () => {
    expect(ids(cardMenu(card())).some((id) => id.startsWith("dev:"))).toBe(false);
    const withDev = card({ review: { dev: "npm run dev", steps: [] } as unknown as Card["review"] });
    expect(ids(cardMenu(withDev, null))).toContain("dev:start");
    const up = ids(cardMenu(withDev, { state: "running", reachable: true, log: "" }));
    expect(up).toEqual(expect.arrayContaining(["dev:restart", "dev:stop"]));
    expect(up).not.toContain("dev:start");
  });

  it("copies a resume command only for Claude sessions", () => {
    expect(ids(cardMenu(card()))).not.toContain("copy-resume");
    expect(ids(cardMenu(card({ sessionId: "s1" })))).toContain("copy-resume");
    expect(ids(cardMenu(card({ sessionId: "s1", backend: "puku" as Card["backend"] })))).not.toContain("copy-resume");
  });

  it("labels archive by state", () => {
    expect(item(cardMenu(card({ archived: true })), "archive")?.label).toBe("Unarchive");
  });
});

describe("resumeCommand", () => {
  it("quotes folders with spaces", () => {
    expect(resumeCommand(card({ cwd: "/a b/it's", sessionId: "s1" }))).toBe(`cd '/a b/it'\\''s' && claude --resume s1`);
    expect(resumeCommand(card({ cwd: "/w/x", sessionId: "s1" }))).toBe("cd /w/x && claude --resume s1");
  });
});

describe("columnMenu", () => {
  it("offers a new thread everywhere and archive tools in Done", () => {
    expect(ids(columnMenu("review", { count: 3, archived: 2, showArchived: false }))).toEqual(["new"]);
    expect(ids(columnMenu("done", { count: 3, archived: 2, showArchived: false }))).toEqual(["new", "toggle-archived", "archive-done"]);
    expect(ids(columnMenu("done", { count: 0, archived: 0, showArchived: false }))).toEqual(["new"]);
  });
});
