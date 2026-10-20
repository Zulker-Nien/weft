// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import StandaloneBrowserPane, { SLIDE_MS } from "./StandaloneBrowserPane";

// The standalone browser pane's slide-in/slide-out wrapper: a child that mounts when the
// pane is open (and during the close animation), and unmounts once the slide finishes.
describe("StandaloneBrowserPane", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const pane = (open: boolean) => (
    <StandaloneBrowserPane open={open} width={400}>
      {(sliding) => <div data-testid="child" data-sliding={String(sliding)}>pane</div>}
    </StandaloneBrowserPane>
  );

  it("renders the child when open", () => {
    render(pane(true));
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("keeps the child mounted during the close animation, then unmounts", () => {
    const { rerender } = render(pane(true));
    rerender(pane(false));
    // Still mounted during the slide-out.
    expect(screen.getByTestId("child")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.queryByTestId("child")).not.toBeInTheDocument();
  });

  it("renders nothing when closed without ever being open", () => {
    render(pane(false));
    expect(screen.queryByTestId("child")).not.toBeInTheDocument();
  });

  it("sets the wrapper width to 0 when closed and to the given width when open", () => {
    const { rerender, container } = render(pane(true));
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.width).toBe("400px");

    rerender(pane(false));
    expect(wrapper.style.width).toBe("0px");
    // The child stays visible until the slide-out's timeout fires.
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  // As a block child the pane shrank to its toolbar, its page placeholder measured 0 px tall and the shell hid the page.
  it("is a flex row, so the pane stretches to the board's full height", () => {
    const { container } = render(pane(true));
    expect((container.firstChild as HTMLElement).className).toMatch(/(^|\s)flex(\s|$)/);
  });

  it("is not sliding when it mounts already open", () => {
    render(pane(true));
    expect(screen.getByTestId("child").dataset.sliding).toBe("false");
  });

  // The page is a native view CSS can't clip, so the pane keeps it hidden until the slide-in ends.
  it("reports sliding from the first render after it opens until the slide ends", () => {
    const { rerender } = render(pane(false));
    rerender(pane(true));
    expect(screen.getByTestId("child").dataset.sliding).toBe("true");
    act(() => {
      vi.advanceTimersByTime(SLIDE_MS);
    });
    expect(screen.getByTestId("child").dataset.sliding).toBe("false");
  });

  it("stops sliding when it closes mid-slide", () => {
    const { rerender } = render(pane(false));
    rerender(pane(true));
    rerender(pane(false));
    expect(screen.getByTestId("child").dataset.sliding).toBe("false");
  });
});
