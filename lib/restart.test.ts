import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadItem } from "./types";

const h = vi.hoisted(() => ({ busy: false, thread: [] as ThreadItem[], retry: vi.fn(() => Promise.resolve()) }));
vi.mock("./runner", () => ({ isBusy: () => h.busy, retry: h.retry }));
vi.mock("./store", () => ({ getThread: () => h.thread }));
const { restartTurn } = await import("./restart");

beforeEach(() => {
  h.busy = false;
  h.thread = [{ kind: "user", text: "build it", at: 1 }];
  h.retry.mockClear();
});

describe("restartTurn", () => {
  it("runs the card's last message again in a fresh CLI", async () => {
    await restartTurn("c1");
    expect(h.retry).toHaveBeenCalledWith("c1");
  });

  it("refuses a thread that is running", async () => {
    h.busy = true;
    await expect(restartTurn("c1")).rejects.toThrow("already running");
    expect(h.retry).not.toHaveBeenCalled();
  });

  it("refuses a thread with no message of yours to run again", async () => {
    h.thread = [{ kind: "assistant", text: "hi", at: 1 }];
    await expect(restartTurn("c1")).rejects.toThrow("no message to run again");
    expect(h.retry).not.toHaveBeenCalled();
  });
});
