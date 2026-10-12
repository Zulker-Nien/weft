import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLOSED_LINE } from "./card-resume";
import type { Card } from "./types";

const api = vi.hoisted(() => ({ send: vi.fn(() => Promise.resolve()), restart: vi.fn(() => Promise.resolve()) }));
vi.mock("./client", () => ({ api }));
const { resumeActions } = await import("./resume-actions");

const card = (id: string, over: Partial<Card> = {}): Card => ({
  id, title: id, prompt: "p", cwd: "/x", backend: "claude", permissionMode: "default",
  column: "review", lastLine: CLOSED_LINE, sessionId: "s", createdAt: 0, updatedAt: 0, ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("resumeActions", () => {
  it("resume sends continue, or restarts, and hands a failure to notify", async () => {
    const notify = vi.fn();
    const { resume } = resumeActions([], notify);
    resume("a", "continue");
    expect(api.send).toHaveBeenCalledWith("a", "continue");
    api.restart.mockRejectedValueOnce(new Error("no message"));
    resume("b", "restart");
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(new Error("no message")));
  });

  it("all runs each cut-off Review card, and is missing when there are none", () => {
    expect(resumeActions([card("done", { lastLine: "All done" })], vi.fn()).all).toBeUndefined();
    const { all } = resumeActions([card("a"), card("b", { sessionId: undefined })], vi.fn());
    expect(all!.count).toBe(2);
    all!.run();
    expect(api.send).toHaveBeenCalledWith("a", "continue");
    expect(api.restart).toHaveBeenCalledWith("b");
  });
});
