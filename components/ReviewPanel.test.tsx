// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCard } from "./test-utils";
import ReviewPanel from "./ReviewPanel";

vi.mock("@/lib/client", () => ({ api: { devAction: vi.fn(() => Promise.resolve({ status: {} })) } }));
vi.mock("./Composer", () => import("./composer-mock"));

const review = { steps: [{ title: "First", look: "a" }, { title: "Second", look: "b" }] };
const card = makeCard({ id: "c1", review });

function setup() {
  const onSend = vi.fn(() => Promise.resolve());
  const view = render(<ReviewPanel card={card} items={[]} onSend={onSend} />);
  return { onSend, view };
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("ReviewPanel feedback draft", () => {
  it("keeps what was typed when the card is closed and reopened", async () => {
    const first = setup();
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "half a thought");
    first.view.unmount();
    setup();
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("half a thought");
    expect(screen.getByRole("button", { name: "Send feedback" })).toBeEnabled();
  });

  it("keeps a separate draft per step", async () => {
    setup();
    const box = screen.getByRole("textbox", { name: "Message" });
    await userEvent.type(box, "one");
    await userEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(box).toHaveValue("");
    await userEvent.type(box, "two");
    await userEvent.click(screen.getByRole("button", { name: "Previous step" }));
    expect(box).toHaveValue("one");
  });

  it("drops the draft once the feedback is sent", async () => {
    const { onSend } = setup();
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "broken{Enter}");
    expect(onSend).toHaveBeenCalled();
    expect(localStorage.getItem("weft.review.c1.0")).toBeNull();
  });
});
