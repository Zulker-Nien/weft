// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RestartStatus } from "@/lib/types";

const cancelRestart = vi.fn(() => Promise.resolve({ armed: false, waiting: [] }));
vi.mock("@/lib/client", () => ({ api: { cancelRestart: () => cancelRestart() } }));

const { default: RestartChip, RestartRequested } = await import("./RestartChip");

afterEach(() => {
  cleanup();
  cancelRestart.mockClear();
});

const waiting = [
  { id: "a", title: "Fix login" },
  { id: "b", title: "Ship docs" },
];

function setup(restart: RestartStatus | null) {
  const notify = vi.fn();
  const view = render(<RestartChip restart={restart} notify={notify} />);
  return { notify, view };
}

describe("RestartChip", () => {
  it("shows nothing while no restart is armed", () => {
    const { view } = setup({ armed: false, waiting });
    expect(view.container.innerHTML).toBe("");
    setup(null);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("counts the threads it waits on, names them on hover, and cancels on click", async () => {
    setup({ armed: true, then: "relaunch", waiting });
    const chip = screen.getByRole("button", { name: "⟳ Restart requested · 2" });
    await userEvent.hover(chip);
    expect(await screen.findByText(/Fix login/)).toBeTruthy();
    expect(screen.getByText(/Ship docs/)).toBeTruthy();
    await userEvent.click(chip);
    expect(cancelRestart).toHaveBeenCalled();
  });

  it("says update when the updater armed it, and restarting once nothing's left", async () => {
    setup({ armed: true, then: "update", waiting: [waiting[0]!] });
    const chip = screen.getByRole("button", { name: "⟳ Update requested · 1" });
    await userEvent.hover(chip);
    expect(await screen.findByText(/this thread/)).toBeTruthy();
    cleanup();
    setup({ armed: true, then: "update", waiting: [] });
    expect(screen.getByRole("button", { name: "⟳ Updating…" })).toBeTruthy();
    cleanup();
    setup({ armed: true, then: "relaunch", waiting: [] });
    expect(screen.getByRole("button", { name: "⟳ Restarting…" })).toBeTruthy();
  });

  it("reports a failed cancel", async () => {
    cancelRestart.mockRejectedValueOnce(new Error("offline"));
    const { notify } = setup({ armed: true, then: "relaunch", waiting });
    await userEvent.click(screen.getByRole("button"));
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(expect.any(Error)));
  });
});

describe("RestartRequested", () => {
  it("shows the red pill only while a restart is armed", () => {
    const view = render(<RestartRequested restart={{ armed: false, waiting }} />);
    expect(view.container.innerHTML).toBe("");
    cleanup();
    render(<RestartRequested restart={{ armed: true, then: "relaunch", waiting }} />);
    expect(screen.getByText("Restart requested")).toBeTruthy();
  });
});
