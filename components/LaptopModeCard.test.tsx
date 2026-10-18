// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShellBridge } from "@/lib/client";
import LaptopModeCard from "./LaptopModeCard";
import "./test-utils";

const baseState = { mode: "off" } as const;

describe("LaptopModeCard", () => {
  // The bridge is rebuilt in beforeEach, but the mocks are kept on this object so tests can read
  // them with their full Mock type. The window.weft slot is set to the same shape as a
  // ShellBridge would have, cast through unknown to keep the cast honest.
  let kw: {
    state: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    onChange: ReturnType<typeof vi.fn>;
  };
  let onChangeListeners: Array<() => void>;

  beforeEach(() => {
    onChangeListeners = [];
    kw = {
      state: vi.fn().mockResolvedValue({ ...baseState }),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      onChange: vi.fn((cb: () => void) => {
        onChangeListeners.push(cb);
        return () => {
          const i = onChangeListeners.indexOf(cb);
          if (i >= 0) onChangeListeners.splice(i, 1);
        };
      }),
    };
    window.weft = { keepWorking: kw } as unknown as ShellBridge;
  });

  afterEach(() => {
    delete window.weft;
  });

  it("renders five chips and a status line, calls start on click", async () => {
    render(<LaptopModeCard />);
    // The card settles on "off" with the standard status text.
    expect(await screen.findByTestId("laptop-mode-status")).toHaveTextContent(/Off:/);
    // The five choices: "Until threads finish", then "For 1/2/3/8 hours".
    expect(screen.getByRole("button", { name: "Until threads finish" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "For 1 hour" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "For 2 hours" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "For 3 hours" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "For 8 hours" })).toBeInTheDocument();
    // No "Turn off" when off.
    expect(screen.queryByRole("button", { name: "Turn off" })).not.toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "For 2 hours" }));
    });
    expect(kw.start).toHaveBeenCalledWith("hours", 2);
  });

  it("shows Turn off and calls stop when on", async () => {
    kw.state.mockResolvedValue({ mode: "hours", hours: 1, until: Date.now() + 3_600_000 });
    render(<LaptopModeCard />);
    const turnOff = await screen.findByRole("button", { name: "Turn off" });
    act(() => {
      fireEvent.click(turnOff);
    });
    expect(kw.stop).toHaveBeenCalledOnce();
  });

  it("refreshes its state when main pushes a change", async () => {
    render(<LaptopModeCard />);
    expect(await screen.findByTestId("laptop-mode-status")).toHaveTextContent(/Off:/);
    kw.state.mockResolvedValueOnce({ mode: "threads", running: 2 });
    act(() => {
      for (const cb of onChangeListeners) cb();
    });
    await waitFor(() => expect(screen.getByTestId("laptop-mode-status")).toHaveTextContent(/On until threads finish \(2 running\)/));
  });
});
