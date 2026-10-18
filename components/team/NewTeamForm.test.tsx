// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TeamClientActions } from "@/lib/team-types";
import "../test-utils";
import { NewTeamForm } from "./NewTeamForm";

function setup(result: Awaited<ReturnType<TeamClientActions["createTeam"]>>) {
  const actions = { createTeam: vi.fn().mockResolvedValue(result) } as unknown as TeamClientActions;
  const onCreated = vi.fn();
  const onCancel = vi.fn();
  render(<NewTeamForm actions={actions} onCreated={onCreated} onCancel={onCancel} />);
  return { actions, onCreated, onCancel };
}

describe("NewTeamForm", () => {
  it("creates the team and hands over its slug", async () => {
    const { actions, onCreated } = setup({ ok: true, slug: "new-co" });
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Team name"), "  New Co ");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("new-co"));
    expect(actions.createTeam).toHaveBeenCalledWith("New Co");
  });

  it("shows the failure message and stays open", async () => {
    const { onCreated } = setup({ ok: false, message: "Name taken." });
    await userEvent.type(screen.getByLabelText("Team name"), "X{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Name taken.");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("falls back to a default message", async () => {
    setup({ ok: false });
    await userEvent.type(screen.getByLabelText("Team name"), "X{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't create the team.");
  });

  it("Cancel and Escape close it", async () => {
    const { onCancel } = setup({ ok: true });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.type(screen.getByLabelText("Team name"), "{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
