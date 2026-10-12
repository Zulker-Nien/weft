// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const copilot = vi.fn<() => Promise<{ card: Card }>>();
const playChime = vi.fn<(kind: string) => void>();
vi.mock("./client", () => ({ api: { copilot: () => copilot() } }));
vi.mock("./chimes", () => ({ playChime: (kind: string) => playChime(kind) }));

const { useCopilotCard } = await import("./use-copilot-card");

const card = (column: Card["column"]) => ({ id: "pilot", role: "copilot", title: "Copilot", column }) as Card;

beforeEach(() => {
  copilot.mockReset();
  playChime.mockReset();
});

afterEach(cleanup);

describe("useCopilotCard", () => {
  it("starts with no copilot card", () => {
    const { result } = renderHook(() => useCopilotCard());
    expect(result.current.copilot).toBeNull();
  });

  it("loads the copilot card without a chime", async () => {
    copilot.mockResolvedValue({ card: card("needs_you") });
    const { result } = renderHook(() => useCopilotCard());
    act(() => result.current.load());
    await waitFor(() => expect(result.current.copilot?.column).toBe("needs_you"));
    expect(playChime).not.toHaveBeenCalled();
  });

  it("ignores a failed load", async () => {
    copilot.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useCopilotCard());
    act(() => result.current.load());
    await Promise.resolve();
    expect(result.current.copilot).toBeNull();
  });

  it("chimes when a live update moves it into Needs you", () => {
    const { result } = renderHook(() => useCopilotCard());
    act(() => result.current.update(card("running")));
    expect(playChime).not.toHaveBeenCalled();
    act(() => result.current.update(card("needs_you")));
    expect(playChime).toHaveBeenCalledWith("needs_you");
    expect(result.current.copilot?.column).toBe("needs_you");
  });

  it("doesn't chime again while it stays in Needs you", () => {
    const { result } = renderHook(() => useCopilotCard());
    act(() => result.current.update(card("needs_you")));
    act(() => result.current.update(card("needs_you")));
    expect(playChime).not.toHaveBeenCalled();
  });
});
