// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TeamClientActions } from "@/lib/team-types";
import "../test-utils";
import { TeamList } from "./TeamList";

const orgs = [
  { id: "1", slug: "acme", name: "Acme", role: "owner" as const },
  { id: "2", slug: "weft", name: "Weft Co", role: "member" as const },
  { id: "3", slug: "old", name: "Old Co" },
];
const labels = { owner: "Owner", admin: "Admin", member: "Member" };
const list = (props: Partial<Parameters<typeof TeamList>[0]> = {}) => (
  <TeamList orgs={orgs} current="acme" loading={false} roleLabels={labels} actions={{} as TeamClientActions} onSwitch={vi.fn()} {...props} />
);

describe("TeamList", () => {
  it("lists every team with your role and marks the one on screen", () => {
    render(list());
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("AcmeOwnerViewing");
    expect(rows[1]).toHaveTextContent("Weft CoMember");
    expect(rows[2]).toHaveTextContent("Old Co");
    expect(screen.getByRole("button", { current: true })).toHaveTextContent("Acme");
  });

  it("switches on a click of another row, not of the current one, and prefetches on hover", async () => {
    const onSwitch = vi.fn();
    const onHover = vi.fn();
    render(list({ onSwitch, onHover }));
    await userEvent.click(screen.getByRole("button", { name: "Acme" }));
    expect(onSwitch).not.toHaveBeenCalled();
    await userEvent.hover(screen.getByRole("button", { name: "Weft Co" }));
    expect(onHover).toHaveBeenCalledWith("weft");
    await userEvent.click(screen.getByRole("button", { name: "Weft Co" }));
    expect(onSwitch).toHaveBeenCalledWith("weft");
  });

  it("shows a spinner instead of Viewing while the picked team loads", () => {
    render(list({ current: "weft", loading: true }));
    expect(screen.queryByText("Viewing")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { current: true })).toHaveTextContent("Weft Co");
  });

  it("New team opens the name field, then switches to the new slug", async () => {
    const onSwitch = vi.fn();
    const actions = { createTeam: vi.fn().mockResolvedValue({ ok: true, slug: "new-co" }) } as unknown as TeamClientActions;
    render(list({ actions, onSwitch }));
    await userEvent.click(screen.getByRole("button", { name: "New team" }));
    await userEvent.type(screen.getByLabelText("Team name"), "New Co{Enter}");
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith("new-co"));
    expect(screen.getByRole("button", { name: "New team" })).toBeInTheDocument();
  });

  it("Cancel closes the name field", async () => {
    render(list());
    await userEvent.click(screen.getByRole("button", { name: "New team" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Team name")).not.toBeInTheDocument();
  });

  it("offers Rename only on the teams you own", () => {
    render(list());
    expect(screen.getByRole("button", { name: "Rename Acme" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename Weft Co" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename Old Co" })).not.toBeInTheDocument();
  });

  it("renames in place by slug, without switching, and closes when it worked", async () => {
    const onSwitch = vi.fn();
    const actions = { renameTeam: vi.fn().mockResolvedValue({ ok: true }) } as unknown as TeamClientActions;
    render(list({ actions, onSwitch, current: "weft" }));
    await userEvent.click(screen.getByRole("button", { name: "Rename Acme" }));
    const field = screen.getByLabelText("Team name");
    expect(field).toHaveValue("Acme");
    await userEvent.clear(field);
    await userEvent.type(field, "Acme Labs{Enter}");
    await waitFor(() => expect(actions.renameTeam).toHaveBeenCalledWith("acme", "Acme Labs"));
    await waitFor(() => expect(screen.queryByLabelText("Team name")).not.toBeInTheDocument());
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("keeps the field open with the reason when the rename fails", async () => {
    const actions = { renameTeam: vi.fn().mockResolvedValue({ ok: false }) } as unknown as TeamClientActions;
    render(list({ actions }));
    await userEvent.click(screen.getByRole("button", { name: "Rename Acme" }));
    await userEvent.type(screen.getByLabelText("Team name"), "!{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't rename the team.");
    expect(screen.getByLabelText("Team name")).toBeInTheDocument();
  });

  it("closes without a call when the name is unchanged, and Escape stays out of the dialog", async () => {
    const actions = { renameTeam: vi.fn() } as unknown as TeamClientActions;
    render(list({ actions }));
    await userEvent.click(screen.getByRole("button", { name: "Rename Acme" }));
    await userEvent.type(screen.getByLabelText("Team name"), "{Enter}");
    expect(screen.queryByLabelText("Team name")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Rename Acme" }));
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    fireEvent.keyDown(screen.getByLabelText("Team name"), { key: "Escape" });
    expect(screen.queryByLabelText("Team name")).not.toBeInTheDocument();
    expect(onWindowKey).not.toHaveBeenCalled();
    expect(actions.renameTeam).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindowKey);
  });

  it("offers Delete only on teams you own, and only while you're in another team", () => {
    const { unmount } = render(list());
    expect(screen.getByRole("button", { name: "Delete Acme" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Weft Co" })).not.toBeInTheDocument();
    unmount();
    render(list({ orgs: [orgs[0]!] }));
    expect(screen.getByRole("button", { name: "Rename Acme" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Acme" })).not.toBeInTheDocument();
  });

  it("deletes only after the name is typed, then moves off the deleted team", async () => {
    const onSwitch = vi.fn();
    const actions = { deleteTeam: vi.fn().mockResolvedValue({ ok: true }) } as unknown as TeamClientActions;
    render(list({ actions, onSwitch }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Acme" }));
    const confirm = screen.getByRole("button", { name: "Delete team" });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Type the team's name to confirm"), "Acm");
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Type the team's name to confirm"), "e");
    await userEvent.click(confirm);
    await waitFor(() => expect(actions.deleteTeam).toHaveBeenCalledWith("acme", "Acme"));
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith("weft"));
    expect(screen.queryByRole("button", { name: "Delete team" })).not.toBeInTheDocument();
  });

  it("stays put when the deleted team wasn't the one on screen", async () => {
    const onSwitch = vi.fn();
    const actions = { deleteTeam: vi.fn().mockResolvedValue({ ok: true }) } as unknown as TeamClientActions;
    render(list({ actions, onSwitch, current: "weft" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Acme" }));
    await userEvent.type(screen.getByLabelText("Type the team's name to confirm"), "Acme{Enter}");
    await waitFor(() => expect(actions.deleteTeam).toHaveBeenCalled());
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("shows why weft.zip refused, and Escape or Cancel close it", async () => {
    const actions = { deleteTeam: vi.fn().mockResolvedValueOnce({ ok: false, message: "Cancel Acme's pro plan in Billing first." }).mockResolvedValueOnce({ ok: false }) } as unknown as TeamClientActions;
    render(list({ actions }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Acme" }));
    const field = screen.getByLabelText("Type the team's name to confirm");
    await userEvent.type(field, "Acme{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Cancel Acme's pro plan in Billing first.");
    await userEvent.type(field, "{Enter}");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't delete the team."));
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByLabelText("Type the team's name to confirm")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete Acme" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Type the team's name to confirm")).not.toBeInTheDocument();
  });
});
