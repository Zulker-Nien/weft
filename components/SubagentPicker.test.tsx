// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SubagentPicker from "./SubagentPicker";
import "./test-utils";

const api = vi.hoisted(() => ({ saveSettings: vi.fn() }));
vi.mock("@/lib/client", () => ({ api }));

beforeEach(() => {
  api.saveSettings.mockReset().mockResolvedValue({});
});

describe("SubagentPicker", () => {
  it("shows the saved model and saves a new pick right away", async () => {
    render(<SubagentPicker value="choose" />);
    const select = screen.getByRole("combobox", { name: "Use for subagents" });
    expect(select).toHaveValue("choose");
    expect(screen.getByRole("option", { name: "Let the model choose" })).toBeInTheDocument();
    await userEvent.selectOptions(select, "haiku");
    expect(api.saveSettings).toHaveBeenCalledWith({ subagentModel: "haiku" });
    expect(select).toHaveValue("haiku");
  });

  it("goes back and says why when the save fails", async () => {
    api.saveSettings.mockRejectedValue(new Error("offline"));
    render(<SubagentPicker value="sonnet" />);
    const select = screen.getByRole("combobox", { name: "Use for subagents" });
    await userEvent.selectOptions(select, "opus");
    await waitFor(() => expect(select).toHaveValue("sonnet"));
    expect(screen.getByText("Couldn’t save: offline")).toBeInTheDocument();
  });
});
