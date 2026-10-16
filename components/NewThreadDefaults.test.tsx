// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import NewThreadDefaults from "./NewThreadDefaults";
import "./test-utils";

// localStorage is empty, so modelFor() returns the default for each backend.
describe("NewThreadDefaults", () => {
  it("shows the CLI, model and effort pickers with the backend's default model", () => {
    render(<NewThreadDefaults backend="claude" onBackend={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Default CLI" })).toHaveValue("claude");
    expect(screen.getByRole("combobox", { name: "Default model" })).toHaveValue("claude-opus-5-5");
    expect(screen.getByRole("combobox", { name: "Default effort" })).toHaveValue("high");
  });

  it("filters the model menu to the selected backend's group", () => {
    const { rerender } = render(<NewThreadDefaults backend="claude" onBackend={() => {}} />);
    expect(screen.getByRole("group", { name: "Models" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Codex" })).not.toBeInTheDocument();

    rerender(<NewThreadDefaults backend="puku" onBackend={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Default model" })).toHaveValue("opus-4.8");

    rerender(<NewThreadDefaults backend="codex" onBackend={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Default model" })).toHaveValue("codex-default");
    expect(screen.getByRole("group", { name: "Codex" })).toBeInTheDocument();
  });

  it("forwards a new backend pick", async () => {
    const onBackend = vi.fn();
    render(<NewThreadDefaults backend="claude" onBackend={onBackend} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Default CLI" }), "codex");
    expect(onBackend).toHaveBeenCalledWith("codex");
  });
});
