// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import { guarded } from "./guarded";

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

function Hello({ name }: { name: string }) {
  return <p>Hello {name}</p>;
}

describe("guarded", () => {
  it("draws the component once its module loads", async () => {
    const Guarded = guarded(() => Promise.resolve({ default: Hello }), { what: "greeting" });
    render(<Guarded name="Weft" />);
    expect(await screen.findByText("Hello Weft")).toBeInTheDocument();
  });

  it("starts loading before it's drawn, and draws at once the next time", async () => {
    const load = vi.fn(() => Promise.resolve({ default: Hello }));
    const Guarded = guarded(load, { what: "greeting" });
    expect(load).toHaveBeenCalledTimes(1);
    const first = render(<Guarded name="one" />);
    await screen.findByText("Hello one");
    first.unmount();
    render(<Guarded name="two" />);
    expect(screen.getByText("Hello two")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("catches a module that throws as it loads, leaves its siblings, and imports it again on Try again", async () => {
    let broken = true;
    const load = vi.fn(() =>
      broken ? Promise.reject(new ReferenceError("BlastcpLogo is not defined")) : Promise.resolve({ default: Hello }),
    );
    const Guarded = guarded(load, { what: "library" });
    render(
      <>
        <Guarded name="rail" guardName="Library" />
        <p>The board</p>
      </>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("This library failed to draw: Library");
    expect(screen.getByText("BlastcpLogo is not defined")).toBeInTheDocument();
    expect(screen.getByText("The board")).toBeInTheDocument();

    broken = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Hello rail")).toBeInTheDocument();
  });

  it("offers the component's own onClose as Close when it fails", async () => {
    const onClose = vi.fn();
    const Dialog = guarded<{ onClose: () => void }>(() => Promise.reject(new Error("Toggle is not defined")), { what: "settings" });
    render(<Dialog onClose={onClose} />);
    await userEvent.click(await screen.findByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("draws the placeholder while the module loads", () => {
    const Guarded = guarded(() => new Promise<{ default: typeof Hello }>(() => {}), { what: "card", placeholder: <p>Loading</p> });
    render(<Guarded name="x" />);
    expect(screen.getByText("Loading")).toBeInTheDocument();
  });
});
