import { describe, expect, it, vi } from "vitest";
import type { Pending, Session } from "./runner-state";
import type { PermissionMode } from "./types";

vi.mock("./store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./store")>()),
  getCard: () => undefined,
  replaceThreadItem: vi.fn(),
}));

const { modeWhy, settle } = await import("./runner-ask");
const { sessions } = await import("./runner-state");

describe("modeWhy", () => {
  it("names the card's permission mode and the tool it asks before", () => {
    expect(modeWhy("default", "Edit")).toEqual({ category: "mode", detail: "Ask me asks before Edit" });
    expect(modeWhy("acceptEdits", "Bash")).toEqual({ category: "mode", detail: "Accept edits asks before Bash" });
  });

  it("still reads for a mode it doesn't know", () => {
    expect(modeWhy("plan" as PermissionMode, "Write")).toEqual({ category: "mode", detail: "This card asks before Write" });
  });
});

describe("settle with a deny message", () => {
  it("tells the thread that message instead of the user's denial (a Wait that ended)", () => {
    const resolve = vi.fn();
    const p = { id: "p1", index: 0, toolName: "Edit", title: "t", input: {}, resolve } as Pending;
    sessions.set("ask-me", { pending: [p] } as unknown as Session);
    expect(settle("ask-me", false, undefined, "p1", undefined, "Re-read a.ts")).toBe(true);
    expect(resolve).toHaveBeenCalledWith({ behavior: "deny", message: "Re-read a.ts" });
    sessions.delete("ask-me");
  });
});
