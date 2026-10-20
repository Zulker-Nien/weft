// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "./test-utils";
import type { SkillSetRow, SkillSetView } from "@/lib/types";
import SkillSetList from "./SkillSetList";

const row = (over: Partial<SkillSetRow>): SkillSetRow => ({ kind: "skill", name: "x", description: "", source: "user", inProject: true, on: true, changedHere: false, ...over });

const view: SkillSetView = {
  seeded: true,
  rows: [
    row({ name: "weft:done", source: "weft", description: "Wrap up" }),
    row({ name: "tdac", description: "Arrival card", on: false, inProject: false }),
    row({ name: "commit", on: false, inProject: true, changedHere: true }),
    row({ kind: "plugin", name: "posthog@posthog", label: "posthog", source: "plugin", skills: 173, on: false, inProject: false }),
  ],
};

describe("SkillSetList", () => {
  it("shows a loading line until the set arrives", () => {
    render(<SkillSetList view={null} forCard={false} onToggle={vi.fn()} />);
    expect(screen.getByText("Loading skills…")).toBeInTheDocument();
  });

  it("groups rows with their on counts, a plugin with its skill count", () => {
    render(<SkillSetList view={view} forCard={false} onToggle={vi.fn()} />);
    expect(screen.getByText("Weft")).toBeInTheDocument();
    expect(screen.getByText("Yours · ~/.claude/skills")).toBeInTheDocument();
    expect(screen.getByText("0/2 on")).toBeInTheDocument();
    expect(screen.getByText("posthog · 173 skills")).toBeInTheDocument();
    expect(screen.queryByText("This project")).not.toBeInTheDocument();
  });

  it("switches a row", async () => {
    const onToggle = vi.fn();
    render(<SkillSetList view={view} forCard={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("switch", { name: "/tdac off" }));
    expect(onToggle).toHaveBeenCalledWith("tdac", true);
    await userEvent.click(screen.getByRole("switch", { name: "/weft:done on" }));
    expect(onToggle).toHaveBeenCalledWith("weft:done", false);
  });

  it("filters, and says when nothing matches", async () => {
    render(<SkillSetList view={view} forCard={false} onToggle={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Filter skills"), "arrival");
    expect(screen.getByText("/tdac")).toBeInTheDocument();
    expect(screen.queryByText("/weft:done")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Filter skills"), "zzz");
    expect(screen.getByText(/No skill matches/)).toBeInTheDocument();
  });

  it("marks a card's change from its project, only in a card's menu", () => {
    const { unmount } = render(<SkillSetList view={view} forCard onToggle={vi.fn()} />);
    expect(screen.getByLabelText("Off for this card; on in the project")).toBeInTheDocument();
    unmount();
    render(<SkillSetList view={view} forCard={false} onToggle={vi.fn()} />);
    expect(screen.queryByLabelText("Off for this card; on in the project")).not.toBeInTheDocument();
  });

  it("says when the project's set isn't seeded yet", () => {
    render(<SkillSetList view={{ ...view, seeded: false }} forCard={false} onToggle={vi.fn()} />);
    expect(screen.getByText(/Until then every skill is on/)).toBeInTheDocument();
  });
});
