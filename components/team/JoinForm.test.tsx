// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JoinForm, type JoinActionState } from "./JoinForm";
import "../test-utils";

beforeEach(() => vi.clearAllMocks());

describe("JoinForm", () => {
  it("shows a single submit button labelled with the org name", () => {
    const action = vi.fn(() => Promise.resolve({ ok: false as const, message: "" }));
    render(<JoinForm token="t0k" orgName="Ada's workspace" action={action} />);
    expect(screen.getByRole("button", { name: "Join Ada's workspace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join Ada's workspace" })).toBeEnabled();
  });

  it("posts the token in a hidden field", async () => {
    const action = vi.fn((_prev: JoinActionState, formData: FormData) => {
      expect(formData.get("token")).toBe("t0k");
      return Promise.resolve({ ok: false as const, message: "" });
    });
    render(<JoinForm token="t0k" orgName="Ada" action={action} />);
    await userEvent.click(screen.getByRole("button", { name: "Join Ada" }));
    expect(action).toHaveBeenCalled();
  });

  it("disables the button while the action is in flight and shows 'Joining…'", async () => {
    let resolve!: (value: JoinActionState) => void;
    const action = vi.fn(() => new Promise<JoinActionState>((r) => (resolve = r)));
    render(<JoinForm token="t0k" orgName="Ada" action={action} />);
    await userEvent.click(screen.getByRole("button", { name: "Join Ada" }));
    expect(screen.getByRole("button", { name: "Joining…" })).toBeDisabled();
    resolve({ ok: false, message: "Still pending." });
  });

  it("shows the action's error message when the action returns without redirecting", async () => {
    const action = vi.fn(() => Promise.resolve({ ok: false as const, message: "This invite link has expired or was revoked." }));
    render(<JoinForm token="t0k" orgName="Ada" action={action} />);
    await userEvent.click(screen.getByRole("button", { name: "Join Ada" }));
    expect(await screen.findByText("This invite link has expired or was revoked.")).toBeInTheDocument();
  });
});
