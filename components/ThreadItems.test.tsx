// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ThreadItem } from "@/lib/types";
import { ThreadMessage } from "./ThreadItems";

afterEach(cleanup);

const notification = (status: "completed" | "failed" | "stopped"): ThreadItem => ({ kind: "notification", status, summary: `Background command "tests" ${status}`, at: 1 });

describe("a task notification in the thread", () => {
  it("keeps the <task-notification> tag and its summary", () => {
    render(<ThreadMessage item={notification("completed")} cardId="c1" />);
    expect(screen.getByText("<task-notification>")).toBeTruthy();
    expect(screen.getByText('Background command "tests" completed').className).toContain("text-muted");
  });

  it("colors a failed or stopped task", () => {
    render(<ThreadMessage item={notification("failed")} cardId="c1" />);
    render(<ThreadMessage item={notification("stopped")} cardId="c1" />);
    expect(screen.getByText('Background command "tests" failed').className).toContain("text-danger");
    expect(screen.getByText('Background command "tests" stopped').className).toContain("text-warn");
  });
});
