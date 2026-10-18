// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TeamClientActions } from "@/lib/team-types";
import "../test-utils";
import { TeamSwitcher } from "./TeamSwitcher";

const orgs = [
  { id: "1", slug: "acme", name: "Acme", role: "owner" as const },
  { id: "2", slug: "weft", name: "Weft Co" },
];
const labels = { owner: "Owner", admin: "Admin", member: "Member" };

describe("TeamSwitcher", () => {
  it("lists teams with roles, marks the current one and switches", async () => {
    const onSwitch = vi.fn();
    const actions = {} as TeamClientActions;
    render(<TeamSwitcher orgs={orgs} current="acme" roleLabels={labels} actions={actions} onSwitch={onSwitch} />);
    expect(screen.getByRole("option", { name: "✓ Acme · Owner" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox"), "weft");
    expect(onSwitch).toHaveBeenCalledWith("weft");
  });

  it("+ New team opens the name field, then switches to the new slug", async () => {
    const onSwitch = vi.fn();
    const actions = { createTeam: vi.fn().mockResolvedValue({ ok: true, slug: "new-co" }) } as unknown as TeamClientActions;
    render(<TeamSwitcher orgs={orgs} current="acme" roleLabels={labels} actions={actions} onSwitch={onSwitch} />);
    await userEvent.click(screen.getByRole("button", { name: "+ New team" }));
    await userEvent.type(screen.getByLabelText("Team name"), "New Co{Enter}");
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith("new-co"));
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("Cancel returns to the switcher", async () => {
    render(<TeamSwitcher orgs={orgs} current="acme" roleLabels={labels} actions={{} as TeamClientActions} onSwitch={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "+ New team" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });
});
