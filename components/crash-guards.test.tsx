// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import CrashGuard from "./CrashGuard";
import Modal from "./Modal";
import { ThreadEntries, groupThread } from "./ThreadItems";

// A message whose text is "boom" fails to draw, like a Markdown renderer tripping on it.
vi.mock("./Markdown", () => ({
  default: ({ text }: { text: string }) => {
    if (text === "boom") throw new TypeError("Cannot read properties of undefined");
    return <p>{text}</p>;
  },
}));

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

function Throws(): never {
  throw new ReferenceError("QualityBadge is not defined");
}

describe("CrashGuard inline", () => {
  it("draws a small chip naming what broke, and its siblings stay", () => {
    render(
      <>
        <CrashGuard inline what="quality badge"><Throws /></CrashGuard>
        <span>pile badge</span>
      </>,
    );
    const chip = screen.getByRole("alert");
    expect(chip).toHaveTextContent("quality badge");
    expect(chip).toHaveAccessibleName("This quality badge failed to draw. Try again");
    expect(screen.getByText("pile badge")).toBeInTheDocument();
  });

  it("shows why on hover", async () => {
    render(<CrashGuard inline what="skill menu" name="weft"><Throws /></CrashGuard>);
    await userEvent.hover(screen.getByRole("alert"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("This skill menu failed to draw: weft");
    expect(screen.getByRole("tooltip")).toHaveTextContent("QualityBadge is not defined");
  });
});

describe("Modal", () => {
  it("keeps its header and close button when its body fails to draw", async () => {
    const onClose = vi.fn();
    render(<Modal title="Settings" onClose={onClose}><Throws /></Modal>);
    expect(screen.getByRole("alert")).toHaveTextContent("This dialog failed to draw: Settings");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("ThreadEntries", () => {
  it("turns one broken message into a chip and draws the rest", () => {
    const entries = groupThread([
      { kind: "user", text: "fix it", at: 1 },
      { kind: "assistant", text: "boom", at: 2 },
      { kind: "assistant", text: "Fixed.", at: 3 },
    ]);
    render(<ThreadEntries entries={entries} live={false} streaming="" cardId="x" />);
    expect(screen.getByText("fix it")).toBeInTheDocument();
    expect(screen.getByText("Fixed.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("message");
  });

  it("keeps the thread when the reply in progress fails to draw", () => {
    const entries = groupThread([{ kind: "user", text: "fix it", at: 1 }]);
    render(<ThreadEntries entries={entries} live streaming="boom" cardId="x" />);
    expect(screen.getByText("fix it")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("reply in progress");
  });
});
