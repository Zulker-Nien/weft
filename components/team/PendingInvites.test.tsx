// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PendingInvites, type PendingInviteRow } from "./PendingInvites";
import "../test-utils";

vi.mock("@/lib/team-actions", () => ({
  revokeInvite: vi.fn(),
}));

import { revokeInvite } from "@/lib/team-actions";

const mockRevokeInvite = vi.mocked(revokeInvite);

const ada: PendingInviteRow = {
  id: "i1",
  email: "ada@b.co",
  role: "admin",
  roleLabel: "Admin",
  createdAt: "2026-10-01T00:00:00.000Z",
  expiresAt: "2026-10-15T00:00:00.000Z",
};
const grace: PendingInviteRow = {
  id: "i2",
  email: "grace@b.co",
  role: "member",
  roleLabel: "Member",
  createdAt: "2026-10-05T00:00:00.000Z",
  expiresAt: "2026-10-19T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRevokeInvite.mockResolvedValue({ ok: true, message: "Revoked." });
});

describe("PendingInvites", () => {
  it("renders nothing when there are no invites", () => {
    const { container } = render(<PendingInvites orgSlug="acme" invites={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows every invite with email, role and expiry", () => {
    render(<PendingInvites orgSlug="acme" invites={[ada, grace]} />);
    expect(screen.getByText("ada@b.co")).toBeInTheDocument();
    expect(screen.getByText("grace@b.co")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Member")).toBeInTheDocument();
  });

  it("revokes an invite and shows a success message", async () => {
    render(<PendingInvites orgSlug="acme" invites={[ada]} />);
    await userEvent.click(screen.getByRole("button", { name: "Revoke invite for ada@b.co" }));
    await waitFor(() => expect(mockRevokeInvite).toHaveBeenCalled());
    expect(mockRevokeInvite).toHaveBeenCalledWith("acme", "i1");
    expect(await screen.findByText("Revoked.")).toBeInTheDocument();
  });

  it("shows the action's error message when revoke fails", async () => {
    mockRevokeInvite.mockResolvedValueOnce({ ok: false, message: "Already accepted." });
    render(<PendingInvites orgSlug="acme" invites={[ada]} />);
    await userEvent.click(screen.getByRole("button", { name: "Revoke invite for ada@b.co" }));
    expect(await screen.findByText("Already accepted.")).toBeInTheDocument();
  });

  it("disables the revoke button while the action is in flight", async () => {
    let resolve!: (value: { ok: boolean; message?: string }) => void;
    mockRevokeInvite.mockImplementationOnce(() => new Promise<{ ok: boolean; message?: string }>((r) => (resolve = r)));
    render(<PendingInvites orgSlug="acme" invites={[ada]} />);
    await userEvent.click(screen.getByRole("button", { name: "Revoke invite for ada@b.co" }));
    expect(screen.getByRole("button", { name: /Working|Revoke/ })).toBeDisabled();
    resolve({ ok: true, message: "Revoked." });
  });
});
