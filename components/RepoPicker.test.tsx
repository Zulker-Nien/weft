// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import RepoPicker from "./RepoPicker";

const api = vi.hoisted(() => ({
  repos: vi.fn(() => Promise.resolve({ repos: [{ name: "web", path: "/home/dev/web", recentAt: 1, git: true }] })),
  githubRepos: vi.fn(() => Promise.resolve({ repos: [] })),
  newProject: vi.fn((parent: string, name: string) => Promise.resolve({ path: `${parent}/${name}`, projects: [] })),
}));
vi.mock("@/lib/client", () => ({ api }));

function setup() {
  const onChange = vi.fn();
  render(<RepoPicker value="/home/dev/web" home="/home" onChange={onChange} />);
  return { onChange, user: userEvent.setup() };
}

beforeEach(() => vi.clearAllMocks());

describe("RepoPicker new project", () => {
  it("names a new folder in ~/dev, creates it and picks it", async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByRole("button", { name: /web/ }));
    await user.click(screen.getByRole("button", { name: "New project…" }));
    await user.type(screen.getByRole("textbox", { name: "New project name" }), "my app{Enter}");

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("/home/dev/my-app"));
    expect(api.newProject).toHaveBeenCalledWith("/home/dev", "my-app");
    expect(screen.queryByRole("textbox", { name: "New project name" })).not.toBeInTheDocument();
  });

  it("starts from what was typed in the search box", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /web/ }));
    await user.type(screen.getByRole("textbox", { name: "Search folders" }), "zebra");
    await user.click(screen.getByRole("button", { name: "New project…" }));

    expect(screen.getByRole("textbox", { name: "New project name" })).toHaveValue("zebra");
  });

  it("refuses a name the route would reject, and Escape goes back to the list", async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByRole("button", { name: /web/ }));
    await user.click(screen.getByRole("button", { name: "New project…" }));
    await user.type(screen.getByRole("textbox", { name: "New project name" }), ".hidden{Enter}");

    expect(screen.getByText(/Use letters, numbers/)).toBeInTheDocument();
    expect(api.newProject).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("textbox", { name: "Search folders" })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
