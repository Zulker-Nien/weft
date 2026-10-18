// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewPanelNoTour } from "./ReviewPanelNoTour";

afterEach(cleanup);

function setup() {
  const onSend = vi.fn(async () => {});
  render(<ReviewPanelNoTour cardId="c1" items={[]} onSend={onSend} />);
  return onSend;
}

describe("ReviewPanelNoTour", () => {
  it("wraps the thread up with /weft:done from its Done button", async () => {
    const onSend = setup();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onSend).toHaveBeenCalledWith("/weft:done");
  });

  it("asks the thread for a tour", async () => {
    const onSend = setup();
    await userEvent.click(screen.getByRole("button", { name: "Build review tour" }));
    expect(onSend).toHaveBeenCalledWith(expect.stringContaining("weft-review block"));
  });
});
