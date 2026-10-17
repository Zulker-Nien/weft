// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuildError } from "@/lib/build-error";
import BuildErrorBar from "./BuildErrorBar";

let error: BuildError | null = null;
vi.mock("@/lib/build-error", () => ({ useBuildError: () => error }));

afterEach(cleanup);

describe("BuildErrorBar", () => {
  it("draws nothing with no build error", () => {
    error = null;
    render(<BuildErrorBar />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names the file and shows the message on Details", async () => {
    error = { message: "Unexpected token", file: "./lib/home-release.ts (11:3)" };
    render(<BuildErrorBar />);
    expect(screen.getByRole("alert").textContent).toContain("./lib/home-release.ts (11:3)");
    await userEvent.click(screen.getByText("Details"));
    expect(screen.getByText("Unexpected token")).toBeTruthy();
  });

  it("dismisses until a different error shows", async () => {
    error = { message: "Unexpected token", file: "./a.ts (1:1)" };
    const { rerender } = render(<BuildErrorBar />);
    await userEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByRole("alert")).toBeNull();
    error = { message: "Unexpected token", file: "./a.ts (1:1)" };
    rerender(<BuildErrorBar />);
    expect(screen.queryByRole("alert")).toBeNull();
    error = { message: "Missing }", file: "./b.ts (2:2)" };
    rerender(<BuildErrorBar />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
