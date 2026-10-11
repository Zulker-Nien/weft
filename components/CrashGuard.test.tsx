// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import CrashGuard from "./CrashGuard";

let broken = true;
function Flaky() {
  if (broken) throw new ReferenceError("StarButton is not defined");
  return <p>Card body</p>;
}

// React logs every caught render error; keep the test output clean.
beforeEach(() => {
  broken = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("CrashGuard", () => {
  it("draws its children when nothing throws", () => {
    broken = false;
    render(<CrashGuard what="card"><Flaky /></CrashGuard>);
    expect(screen.getByText("Card body")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows which piece broke and why, and leaves its siblings drawn", () => {
    render(
      <>
        <CrashGuard what="card" name="Fix the login page"><Flaky /></CrashGuard>
        <p>Other card</p>
      </>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("This card failed to draw: Fix the login page");
    expect(screen.getByText("StarButton is not defined")).toBeInTheDocument();
    expect(screen.getByText("Other card")).toBeInTheDocument();
  });

  it("draws the children again on Try again once the cause is gone", async () => {
    render(<CrashGuard what="thread"><Flaky /></CrashGuard>);
    expect(screen.getByRole("alert")).toHaveTextContent("This thread failed to draw");
    broken = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Card body")).toBeInTheDocument();
  });

  it("shows a thrown non-Error as text", () => {
    function Throws(): never {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- a thrown string is the case under test
      throw "boom";
    }
    render(<CrashGuard what="browser pane"><Throws /></CrashGuard>);
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});
