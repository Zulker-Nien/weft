// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Roster, type RosterMember, type RoleOption } from "./Roster";
import "../test-utils";

vi.mock("@/lib/team-actions", () => ({
  changeMemberRole: vi.fn(),
  removeMember: vi.fn(),
}));

import { changeMemberRole, removeMember } from "@/lib/team-actions";

const mockChangeMemberRole = vi.mocked(changeMemberRole);
const mockRemoveMember = vi.mocked(removeMember);

const ada: RosterMember = {
  userId: "u1",
  email: "ada@b.co",
  displayName: "Ada",
  role: "owner",
  roleLabel: "Owner",
  joinedAt: "2026-09-01T00:00:00.000Z",
  isYou: true,
};
const grace: RosterMember = {
  userId: "u2",
  email: "grace@b.co",
  displayName: "Grace",
  role: "admin",
  roleLabel: "Admin",
  joinedAt: "2026-10-01T00:00:00.000Z",
  isYou: false,
};
const linus: RosterMember = {
  userId: "u3",
  email: null,
  displayName: null,
  role: "member",
  roleLabel: "Member",
  joinedAt: "2026-10-05T00:00:00.000Z",
  isYou: false,
};

const options: RoleOption[] = [
  { role: "owner", label: "Owner" },
  { role: "admin", label: "Admin" },
  { role: "member", label: "Member" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockChangeMemberRole.mockResolvedValue({ ok: true, message: "Saved." });
  mockRemoveMember.mockResolvedValue({ ok: true, message: "Removed." });
});

describe("Roster", () => {
  it("shows the empty hint when there are no members", () => {
    render(<Roster orgSlug="acme" members={[]} canManage={false} roleOptions={options} currentUserId="u1" />);
    expect(screen.getByText(/No members yet/)).toBeInTheDocument();
  });

  it("renders names, roles, joined dates and the 'you' pill", () => {
    render(<Roster orgSlug="acme" members={[ada, grace, linus]} canManage={false} roleOptions={options} currentUserId="u1" />);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("grace@b.co")).toBeInTheDocument();
    expect(screen.getAllByText("You")).toHaveLength(1);
    // The fallback name is an em-dash when both displayName and email are null.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    // Joined column: each row has a formatted date.
    const dates = screen.getAllByText(/20\d{2}/);
    expect(dates.length).toBeGreaterThanOrEqual(2);
  });

  it("shows the secondary email line when name and email differ", () => {
    render(<Roster orgSlug="acme" members={[ada, grace]} canManage={false} roleOptions={options} currentUserId="u1" />);
    expect(screen.getByText("ada@b.co")).toBeInTheDocument();
  });

  it("hides role select and Remove button for non-managers", () => {
    render(<Roster orgSlug="acme" members={[ada, grace]} canManage={false} roleOptions={options} currentUserId="u1" />);
    expect(screen.queryByRole("combobox", { name: /Role for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
  });

  it("shows role select and Remove button for managers, on rows that aren't you", () => {
    render(<Roster orgSlug="acme" members={[ada, grace]} canManage={true} roleOptions={options} currentUserId="u1" />);
    // Grace gets a select + Remove button; the "you" row (Ada) gets neither.
    const graceSelect = screen.getByRole("combobox", { name: "Role for Grace" });
    expect(graceSelect).toHaveValue("admin");
    const removeButtons = screen.getAllByRole("button", { name: /Remove/ });
    expect(removeButtons).toHaveLength(1);
  });

  it("does not show a Remove button on the manager's own row", () => {
    render(<Roster orgSlug="acme" members={[ada]} canManage roleOptions={options} currentUserId="u1" />);
    // A manager can't remove themselves — Leave workspace is the path off the roster.
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
  });

  it("changing the role select calls changeMemberRole with (orgSlug, userId, formData)", async () => {
    render(<Roster orgSlug="acme" members={[grace]} canManage roleOptions={options} currentUserId="u1" />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role for Grace" }), "owner");
    await waitFor(() => expect(mockChangeMemberRole).toHaveBeenCalledTimes(1));
    const [orgSlug, userId, formData] = mockChangeMemberRole.mock.calls[0]!;
    expect(orgSlug).toBe("acme");
    expect(userId).toBe("u2");
    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get("role")).toBe("owner");
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("shows the action's error message when the change fails", async () => {
    mockChangeMemberRole.mockResolvedValueOnce({ ok: false, message: "You can\u2019t promote to owner." });
    render(<Roster orgSlug="acme" members={[grace]} canManage roleOptions={options} currentUserId="u1" />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role for Grace" }), "owner");
    expect(await screen.findByText("You can\u2019t promote to owner.")).toBeInTheDocument();
  });

  it("Remove button asks for confirmation and calls removeMember when confirmed", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Roster orgSlug="acme" members={[grace]} canManage roleOptions={options} currentUserId="u1" />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Grace" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Grace"));
    await waitFor(() => expect(mockRemoveMember).toHaveBeenCalledTimes(1));
    expect(mockRemoveMember).toHaveBeenCalledWith("acme", "u2");
    expect(await screen.findByText("Removed.")).toBeInTheDocument();
  });

  it("Remove button does not call removeMember when the visitor cancels the confirm", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Roster orgSlug="acme" members={[grace]} canManage roleOptions={options} currentUserId="u1" />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Grace" }));
    expect(confirm).toHaveBeenCalled();
    expect(mockRemoveMember).not.toHaveBeenCalled();
  });

  it("the change action is called with the row's userId", async () => {
    render(<Roster orgSlug="acme" members={[grace, linus]} canManage roleOptions={options} currentUserId="u1" />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role for Grace" }), "member");
    await waitFor(() => expect(mockChangeMemberRole).toHaveBeenCalled());
    expect(mockChangeMemberRole).toHaveBeenCalledWith("acme", "u2", expect.any(FormData));
  });
});
