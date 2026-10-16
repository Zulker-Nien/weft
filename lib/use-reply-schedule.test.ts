// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerHandle } from "@/components/Composer";
import type { ScheduledMessage } from "@/lib/types";

const api = vi.hoisted(() => ({ schedule: vi.fn(), unschedule: vi.fn() }));
vi.mock("@/lib/client", () => ({ api }));

import { useReplySchedule } from "./use-reply-schedule";

function setup(handle: Partial<ComposerHandle> | null) {
  const composer = { current: handle as ComposerHandle | null };
  const saveDraft = vi.fn();
  const setError = vi.fn();
  const hook = renderHook(() => useReplySchedule("c1", composer, saveDraft, setError));
  return { ...hook, saveDraft, setError };
}

const msg = { id: "m1", text: "later" } as ScheduledMessage;

beforeEach(() => {
  vi.clearAllMocks();
  api.schedule.mockResolvedValue(undefined);
  api.unschedule.mockResolvedValue(undefined);
});

describe("useReplySchedule", () => {
  it("schedules the box's text, clears the draft and the box", async () => {
    const handle = { read: vi.fn(() => "hello"), clear: vi.fn(), focus: vi.fn() };
    const { result, saveDraft, setError } = setup(handle);
    await act(() => result.current.scheduleAt(123));
    expect(api.schedule).toHaveBeenCalledWith("c1", "hello", 123);
    expect(saveDraft).toHaveBeenCalledWith("", true);
    expect(handle.clear).toHaveBeenCalled();
    expect(setError).not.toHaveBeenCalled();
  });

  it("reports a read that throws (an upload still running)", async () => {
    const err = new Error("Wait for the upload to finish.");
    const { result, setError } = setup({ read: () => { throw err; } });
    await act(() => result.current.scheduleAt(1));
    expect(setError).toHaveBeenCalledWith(err);
    expect(api.schedule).not.toHaveBeenCalled();
  });

  it("asks for a message when the box is empty, or there is no box", async () => {
    const handle = { read: () => "", focus: vi.fn() };
    const a = setup(handle);
    await act(() => a.result.current.scheduleAt(1));
    expect(a.setError).toHaveBeenCalledWith("Write a message first.");
    expect(handle.focus).toHaveBeenCalled();

    const b = setup(null);
    await act(() => b.result.current.scheduleAt(1));
    expect(b.setError).toHaveBeenCalledWith("Write a message first.");
  });

  it("reports a server failure and keeps the text", async () => {
    api.schedule.mockRejectedValue(new Error("nope"));
    const handle = { read: () => "hi", clear: vi.fn() };
    const { result, setError, saveDraft } = setup(handle);
    await act(() => result.current.scheduleAt(1));
    expect(setError).toHaveBeenCalledWith(expect.any(Error));
    expect(saveDraft).not.toHaveBeenCalled();
    expect(handle.clear).not.toHaveBeenCalled();
  });

  it("unschedules, reporting a failure", async () => {
    const { result, setError } = setup({});
    act(() => result.current.unschedule("m1"));
    expect(api.unschedule).toHaveBeenCalledWith("c1", "m1");
    api.unschedule.mockRejectedValue(new Error("x"));
    await act(() => {
      result.current.unschedule("m2");
      return Promise.resolve();
    });
    expect(setError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("takes a scheduled message back into an empty box", async () => {
    const handle = { isEmpty: () => true, write: vi.fn() };
    const { result, setError } = setup(handle);
    act(() => result.current.takeBackScheduled(msg));
    expect(handle.write).toHaveBeenCalledWith("later");
    expect(api.unschedule).toHaveBeenCalledWith("c1", "m1");
    api.unschedule.mockRejectedValue(new Error("x"));
    await act(() => {
      result.current.takeBackScheduled(msg);
      return Promise.resolve();
    });
    expect(setError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("won't overwrite a box that has text", () => {
    const handle = { isEmpty: () => false, write: vi.fn() };
    const { result, setError } = setup(handle);
    act(() => result.current.takeBackScheduled(msg));
    expect(setError).toHaveBeenCalledWith("Clear the box first to edit a scheduled message.");
    expect(handle.write).not.toHaveBeenCalled();
    expect(api.unschedule).not.toHaveBeenCalled();
  });
});
