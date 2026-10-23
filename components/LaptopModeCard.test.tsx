// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    setPrefs: ReturnType<typeof vi.fn>;
    onChange: ReturnType<typeof vi.fn>;
  };
  let onChangeListeners: Array<() => void>;

  beforeEach(() => {
    onChangeListeners = [];
    kw = {
      state: vi.fn().mockResolvedValue({ ...baseState }),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      setPrefs: vi.fn().mockResolvedValue(undefined),
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

  it("flips Always while threads run through setPrefs", async () => {
    kw.state.mockResolvedValue({ mode: "off", auto: true });
    render(<LaptopModeCard />);
    expect(await screen.findByTestId("laptop-mode-status")).toHaveTextContent(/turns on by itself/);
    const sw = screen.getByRole("switch", { name: "Always while threads run" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    act(() => {
      fireEvent.click(sw);
    });
    expect(kw.setPrefs).toHaveBeenCalledWith({ auto: false });
  });

  it("sets Only while online and the battery floor", async () => {
    kw.state.mockResolvedValue({ mode: "off", minBattery: 10 });
    render(<LaptopModeCard />);
    const floor = await screen.findByRole("group", { name: "Battery floor" });
    expect(within(floor).getByRole("button", { name: "10%" })).toHaveAttribute("aria-pressed", "true");
    act(() => {
      fireEvent.click(within(floor).getByRole("button", { name: "20%" }));
    });
    expect(kw.setPrefs).toHaveBeenCalledWith({ minBattery: 20 });
    await waitFor(() => expect(screen.getByRole("switch", { name: "Only while online" })).not.toBeDisabled());
    act(() => {
      fireEvent.click(screen.getByRole("switch", { name: "Only while online" }));
    });
    expect(kw.setPrefs).toHaveBeenCalledWith({ onlineOnly: true });
  });

  it("says a restart is needed instead of throwing when main has no handler yet", async () => {
    kw.setPrefs.mockRejectedValue(new Error("Error invoking remote method 'keep-working:prefs': Error: No handler registered for 'keep-working:prefs'"));
    render(<LaptopModeCard />);
    const sw = await screen.findByRole("switch", { name: "Only while online" });
    act(() => {
      fireEvent.click(sw);
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Weft needs a restart to change these settings.");
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
