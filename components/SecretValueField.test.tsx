// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SecretValueField } from "./SecretValueField";
import "./test-utils";

function setup() {
  const onChange = vi.fn();
  render(<SecretValueField value="" fixed autoFocus={false} className="" onChange={onChange} />);
  return onChange;
}

describe("SecretValueField", () => {
  it("fills in a random 40-character string from the dice", async () => {
    const onChange = setup();
    await userEvent.click(screen.getByRole("button", { name: "Generate random value" }));
    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^[A-Za-z0-9]{40}$/));
  });

  it("keeps the value hidden until you show it", async () => {
    setup();
    const input = screen.getByLabelText("Value");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("placeholder", "New value");
    await userEvent.click(screen.getByRole("button", { name: "Show value" }));
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide value" })).toBeInTheDocument();
  });
});
