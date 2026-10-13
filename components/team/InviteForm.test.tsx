// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InviteForm, type RoleOption, type InviteActionState } from "./InviteForm";
import "../test-utils";

vi.mock("@/lib/team-actions", () => ({
  inviteMember: vi.fn(),
}));

import { inviteMember } from "@/lib/team-actions";

const mockInviteMember = vi.mocked(inviteMember);

const roleOptions: RoleOption[] = [
  { role: "owner", label: "Owner", description: "Full control." },
  { role: "admin", label: "Admin", description: "Manage the workspace." },
  { role: "member", label: "Member", description: "View and publish." },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockInviteMember.mockResolvedValue({ ok: true, message: "ok" });
});

describe("InviteForm", () => {
  it("shows the role select with the first option pre-picked, plus its description", () => {
    render(<InviteForm orgSlug="acme" roleOptions={roleOptions} />);
    expect(screen.getByRole("combobox", { name: "Role" })).toHaveValue("owner");
    expect(screen.getByText("Full control.")).toBeInTheDocument();
  });

  it("updates the description when the role select changes", async () => {
    render(<InviteForm orgSlug="acme" roleOptions={roleOptions} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role" }), "admin");
    expect(screen.getByText("Manage the workspace.")).toBeInTheDocument();
  });

  it("disables the submit button until an email is entered", async () => {
    render(<InviteForm orgSlug="acme" roleOptions={roleOptions} />);
    expect(screen.getByRole("button", { name: "Send invite" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "ada@b.co");
    expect(screen.getByRole("button", { name: "Send invite" })).toBeEnabled();
  });

  it("submits the email and role through inviteMember bound to orgSlug and shows a success message", async () => {
    mockInviteMember.mockImplementationOnce((_orgSlug: string, _prev: InviteActionState, formData: FormData) => {
      const email = formData.get("email");
      return Promise.resolve({ ok: true, message: "Invite sent to " + (typeof email === "string" ? email : "") });
    });
    render(<InviteForm orgSlug="acme" roleOptions={roleOptions} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "ada@b.co");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role" }), "admin");
    await userEvent.click(screen.getByRole("button", { name: "Send invite" }));
    await waitFor(() => expect(mockInviteMember).toHaveBeenCalled());
    const [orgSlug, , formData] = mockInviteMember.mock.calls[0]!;
    expect(orgSlug).toBe("acme");
    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get("email")).toBe("ada@b.co");
    expect(formData.get("role")).toBe("admin");
    expect(await screen.findByText("Invite sent to ada@b.co")).toBeInTheDocument();
  });

  it("clears the email after a successful invite but keeps the role", async () => {
    mockInviteMember.mockResolvedValueOnce({ ok: true, message: "Sent." });
    render(<InviteForm orgSlug="acme" roleOptions={roleOptions} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "ada@b.co");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role" }), "admin");
    await userEvent.click(screen.getByRole("button", { name: "Send invite" }));
    await waitFor(() => expect(screen.getByText("Sent.")).toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Role" })).toHaveValue("admin");
  });

  it("shows the action's error message when the email is invalid", async () => {
    mockInviteMember.mockResolvedValueOnce({ ok: false, message: "Enter a valid email address." });
    render(<InviteForm orgSlug="acme" roleOptions={roleOptions} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "not-an-email");
    await userEvent.click(screen.getByRole("button", { name: "Send invite" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
  });

  it("disables both inputs and the submit while pending", async () => {
    let resolve!: (value: InviteActionState) => void;
    mockInviteMember.mockImplementationOnce(() => new Promise<InviteActionState>((r) => (resolve = r)));
    render(<InviteForm orgSlug="acme" roleOptions={roleOptions} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "ada@b.co");
    await userEvent.click(screen.getByRole("button", { name: "Send invite" }));
    expect(screen.getByRole("button", { name: /Sending|Send invite/ })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Email" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Role" })).toBeDisabled();
    resolve({ ok: true, message: "Sent." });
  });
});
