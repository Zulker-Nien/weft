import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const cards = new Map<string, Card>();
const sent: Array<[string, string]> = [];

vi.mock("./store", () => ({
  listCards: () => [...cards.values()],
  updateCard: (id: string, patch: Partial<Card>) => Object.assign(cards.get(id)!, patch),
}));
vi.mock("./runner", () => ({
  sendMessage: (id: string, text: string) => {
    if (id === "gone") throw new Error("folder gone");
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the runner can reject with a non-Error
    if (id === "odd") throw "odd";
    sent.push([id, text]);
  },
}));

const { RESUME_TEXT, resumeInterrupted } = await import("./resume");

const card = (id: string, over: Partial<Card> = {}) =>
  cards.set(id, { id, title: id, prompt: "", cwd: "/tmp", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, ...over });

beforeEach(() => {
  cards.clear();
  sent.length = 0;
});

describe("resumeInterrupted", () => {
  it("carries on each cut-off turn in its session and counts the carry-ons in a row", () => {
    card("a", { interrupted: true, sessionId: "s1" });
    card("b", { sessionId: "s2" });
    card("c", { interrupted: true, sessionId: "s3", resumes: 2 });
    resumeInterrupted();
    expect(sent).toEqual([["a", RESUME_TEXT], ["c", RESUME_TEXT]]);
    expect(cards.get("a")).toMatchObject({ resumes: 1, interrupted: true });
    expect(cards.get("c")!.resumes).toBe(3);
  });

  it("leaves a card with no session, an archived one and the copilot stopped", () => {
    card("new", { interrupted: true });
    card("old", { interrupted: true, sessionId: "s", archived: true });
    card("co", { interrupted: true, sessionId: "s", role: "copilot" });
    resumeInterrupted();
    expect(sent).toEqual([]);
    for (const id of ["new", "old", "co"]) expect(cards.get(id)!.interrupted).toBeUndefined();
  });

  it("shows why a resume couldn't start", () => {
    card("gone", { interrupted: true, sessionId: "s" });
    card("odd", { interrupted: true, sessionId: "s" });
    resumeInterrupted();
    expect(cards.get("gone")).toMatchObject({ interrupted: undefined, error: "Couldn't resume after the restart: folder gone" });
    expect(cards.get("odd")!.error).toBe("Couldn't resume after the restart: odd");
  });
});
