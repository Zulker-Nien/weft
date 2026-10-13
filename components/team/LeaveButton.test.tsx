// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeaveButton } from "./LeaveButton";
import "../test-utils";

vi.mock("@/lib/team-actions", () => ({
  removeMember: vi.fn(),
}));

import { removeMember } from "@/lib/team-actions";

const mockRemoveMember = vi.mocked(removeMember);

beforeEach(() => {
  vi.clearAllMocks();
  mockRemoveMember.mockResolvedValue({ ok: true, message: "Left." });
});

describe("LeaveButton", () => {
  it("asks for confirmation before calling the action", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<LeaveButton orgSlug="acme" userId="u1" />);
    await userEvent.click(screen.getByRole("button", { name: "Leave workspace" }));
    expect(confirm).toHaveBeenCalled();
    expect(mockRemoveMember).not.toHaveBeenCalled();
  });

  it("calls the action when the visitor confirms and shows the success message", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<LeaveButton orgSlug="acme" userId="u1" />);
    await userEvent.click(screen.getByRole("button", { name: "Leave workspace" }));
    await waitFor(() => expect(mockRemoveMember).toHaveBeenCalled());
    expect(mockRemoveMember).toHaveBeenCalledWith("acme", "u1");
    expect(await screen.findByText("Left.")).toBeInTheDocument();
  });

  it("shows the action's error message when leave fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockRemoveMember.mockResolvedValueOnce({ ok: false, message: "Owner can't leave." });
    render(<LeaveButton orgSlug="acme" userId="u1" />);
    await userEvent.click(screen.getByRole("button", { name: "Leave workspace" }));
    expect(await screen.findByText("Owner can't leave.")).toBeInTheDocument();
  });

  it("disables the button while the action is in flight", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let resolve!: (value: { ok: boolean; message?: string }) => void;
    mockRemoveMember.mockImplementationOnce(() => new Promise<{ ok: boolean; message?: string }>((r) => (resolve = r)));
    render(<LeaveButton orgSlug="acme" userId="u1" />);
    await userEvent.click(screen.getByRole("button", { name: /Leave|Leaving/ }));
    expect(screen.getByRole("button", { name: /Leaving|Leave/ })).toBeDisabled();
    resolve({ ok: true });
  });
});
