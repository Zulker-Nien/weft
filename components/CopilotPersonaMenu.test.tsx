// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CopilotPersonaMenu from "./CopilotPersonaMenu";
import "./test-utils";

describe("CopilotPersonaMenu", () => {
  it("names the current persona, Wingman when the card has none", () => {
    render(<CopilotPersonaMenu persona={undefined} busy={false} onPick={() => {}} />);
    expect(screen.getByRole("button", { name: /Wingman/ })).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("lists the three, checks the current one, and picks another", async () => {
    const onPick = vi.fn();
    render(<CopilotPersonaMenu persona="founder" busy={false} onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: /Founder/ }));
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual([expect.stringContaining("Wingman"), expect.stringContaining("Founder"), expect.stringContaining("Captain")]);
    expect(items[1]).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Switching starts a new chat.")).toBeInTheDocument();
    await userEvent.click(items[2]!);
    expect(onPick).toHaveBeenCalledWith("captain");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes without a pick on the current persona, Escape or a click away", async () => {
    const onPick = vi.fn();
    render(
      <div>
        <CopilotPersonaMenu persona="captain" busy={false} onPick={onPick} />
        <p>elsewhere</p>
      </div>,
    );
    const name = screen.getByRole("button", { name: /Captain/ });
    await userEvent.click(name);
    await userEvent.click(screen.getAllByRole("menuitemradio")[2]!);
    await userEvent.click(name);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await userEvent.click(name);
    await userEvent.click(screen.getByText("elsewhere"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("is off while the copilot starts or resets", () => {
    render(<CopilotPersonaMenu persona={undefined} busy onPick={() => {}} />);
    expect(screen.getByRole("button", { name: /Wingman/ })).toBeDisabled();
  });
});
