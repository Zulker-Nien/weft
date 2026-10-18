// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Tip from "./Tip";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const bubble = () => screen.queryByRole("tooltip");

describe("Tip", () => {
  it("opens on hover and closes at once when the mouse leaves a plain tip", () => {
    render(<Tip text="Hello">trigger</Tip>);
    fireEvent.mouseEnter(screen.getByText("trigger"));
    expect(bubble()?.textContent).toBe("Hello");
    expect(bubble()?.className).toContain("pointer-events-none");
    fireEvent.mouseLeave(screen.getByText("trigger"));
    expect(bubble()).toBeNull();
  });

  it("keeps an interactive tip open while the mouse crosses into it, and takes its clicks", async () => {
    const onClick = vi.fn();
    render(
      <Tip text={<button onClick={onClick}>Go</button>} interactive>
        trigger
      </Tip>,
    );
    const trigger = screen.getByText("trigger");
    fireEvent.mouseEnter(trigger);
    expect(bubble()?.className).not.toContain("pointer-events-none");
    fireEvent.mouseLeave(trigger);
    await act(() => vi.advanceTimersByTimeAsync(100));
    fireEvent.mouseEnter(bubble()!);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledOnce();
    fireEvent.mouseLeave(bubble()!);
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(bubble()).toBeNull();
  });

  it("closes an interactive tip a moment after the mouse leaves it for good", async () => {
    render(
      <Tip text="Hi" interactive>
        trigger
      </Tip>,
    );
    fireEvent.mouseEnter(screen.getByText("trigger"));
    fireEvent.mouseLeave(screen.getByText("trigger"));
    expect(bubble()).not.toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(bubble()).toBeNull();
  });
});
