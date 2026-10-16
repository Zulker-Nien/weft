// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReviewAllPicker from "./ReviewAllPicker";
import "./test-utils";

const api = vi.hoisted(() => ({ saveSettings: vi.fn() }));
vi.mock("@/lib/client", () => ({ api }));

beforeEach(() => {
  api.saveSettings.mockReset().mockResolvedValue({});
});

describe("ReviewAllPicker", () => {
  it("shows only Claude models and saves a new pick right away", async () => {
    render(<ReviewAllPicker value="claude-opus-5-5" />);
    const select = screen.getByRole("combobox", { name: "Model for Review all" });
    expect(select).toHaveValue("claude-opus-5-5");
    expect(screen.getByRole("group", { name: "Claude" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Puku" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Codex" })).not.toBeInTheDocument();
    await userEvent.selectOptions(select, "claude-sonnet-5-5");
    expect(api.saveSettings).toHaveBeenCalledWith({ reviewAllModel: "claude-sonnet-5-5" });
  });

  it("goes back and says why when the save fails", async () => {
    api.saveSettings.mockRejectedValue(new Error("offline"));
    render(<ReviewAllPicker value="claude-sonnet-5-5" />);
    const select = screen.getByRole("combobox", { name: "Model for Review all" });
    await userEvent.selectOptions(select, "claude-opus-5-5");
    await waitFor(() => expect(select).toHaveValue("claude-sonnet-5-5"));
    expect(screen.getByText("Couldn’t save: offline")).toBeInTheDocument();
  });
});
