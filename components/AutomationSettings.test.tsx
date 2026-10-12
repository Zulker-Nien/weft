// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AutomationSettings from "./AutomationSettings";
import "./test-utils";

const api = vi.hoisted(() => ({ skills: vi.fn(), saveSettings: vi.fn() }));
vi.mock("@/lib/client", () => ({ api }));

beforeEach(() => {
  api.skills.mockReset().mockResolvedValue({ skills: [] });
  api.saveSettings.mockReset().mockResolvedValue({});
});

const rules = [{ id: "default-done", on: "done" as const, skill: "weft:done" }];

describe("AutomationSettings: Push on Done", () => {
  it("shows the saved value and saves a switch right away", async () => {
    render(<AutomationSettings rules={rules} pushOnDone onChange={vi.fn()} />);
    const toggle = screen.getByRole("switch", { name: "Push on Done" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await userEvent.click(toggle);
    expect(api.saveSettings).toHaveBeenCalledWith({ pushOnDone: false });
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("flips back and says why when the save fails", async () => {
    api.saveSettings.mockRejectedValue(new Error("offline"));
    render(<AutomationSettings rules={rules} pushOnDone={false} onChange={vi.fn()} />);
    const toggle = screen.getByRole("switch", { name: "Push on Done" });
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    expect(screen.getByText(/Couldn.t save Push on Done: offline/)).toBeInTheDocument();
  });
});
