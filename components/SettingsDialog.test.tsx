// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsView } from "@/lib/types";
import SettingsDialog from "./SettingsDialog";
import "./test-utils";

const api = vi.hoisted(() => ({ settings: vi.fn(), saveSettings: vi.fn() }));
vi.mock("@/lib/client", () => ({ api }));
// The tabs' own pickers have their own tests; here they only need to show up in the right tab.
vi.mock("./AppearancePicker", () => ({ default: () => <p>appearance picker</p> }));
vi.mock("./AccountSettings", () => ({ default: () => <p>account settings</p> }));
vi.mock("./CliLogins", () => ({ default: () => <p>cli logins</p> }));
vi.mock("./SubagentPicker", () => ({ default: () => <p>subagent picker</p> }));
vi.mock("./DonePicker", () => ({ default: () => <p>done picker</p> }));
vi.mock("./AutomationSettings", () => ({ default: () => <p>automation rules</p> }));

const SETTINGS: SettingsView = {
  threadPrompt: "be nice",
  defaultThreadPrompt: "be nice",
  keepAliveMinutes: 0,
  defaultPermissionMode: "auto",
  defaultBackend: "claude",
  automations: [],
  pushOnDone: false,
  subagentModel: "choose",
  doneModel: "",
  doneEffort: "",
  projects: [],
};

beforeEach(() => {
  api.settings.mockReset().mockResolvedValue(SETTINGS);
  api.saveSettings.mockReset().mockResolvedValue({});
});

const sections = () => screen.getByRole("navigation", { name: "Settings sections" });

describe("SettingsDialog", () => {
  it("shows sections on the left and their tabs on top, one tab at a time", async () => {
    render(<SettingsDialog onClose={() => {}} />);
    expect(screen.getByRole("tab", { name: "Appearance" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("appearance picker")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Board" }));
    expect(screen.getByRole("switch", { name: "Show backlog" })).toBeInTheDocument();
    expect(screen.queryByText("appearance picker")).not.toBeInTheDocument();

    await userEvent.click(within(sections()).getByRole("button", { name: "Accounts" }));
    expect(screen.getByRole("tab", { name: "Weft account" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: "CLIs" }));
    expect(screen.getByText("cli logins")).toBeInTheDocument();

    // Back to General lands on the tab you left it on.
    await userEvent.click(within(sections()).getByRole("button", { name: "General" }));
    expect(screen.getByRole("tab", { name: "Board" })).toHaveAttribute("aria-selected", "true");
  });

  it("marks unsaved edits on the tab and section, and saves them", async () => {
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    await userEvent.click(within(sections()).getByRole("button", { name: "Threads" }));
    const select = await screen.findByRole("combobox", { name: "Default CLI" });
    expect(screen.queryByLabelText("Unsaved changes")).not.toBeInTheDocument();

    await userEvent.selectOptions(select, "puku");
    expect(within(screen.getByRole("tab", { name: /Defaults/ })).getByLabelText("Unsaved changes")).toBeInTheDocument();
    expect(within(sections()).getByLabelText("Unsaved changes")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(api.saveSettings).toHaveBeenCalledWith({ defaultBackend: "puku" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("says when the settings didn't load, on the tabs that need them", async () => {
    api.settings.mockRejectedValue(new Error("offline"));
    render(<SettingsDialog onClose={() => {}} />);
    await userEvent.click(within(sections()).getByRole("button", { name: "Automations" }));
    expect(await screen.findByText("Couldn't load settings: offline")).toBeInTheDocument();
  });
});
