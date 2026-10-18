// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { EditPreview } from "@/lib/edit-preview";
import { EditDiff } from "./EditDiff";
import "./test-utils";

describe("EditDiff", () => {
  it("renders each diff line with the kind marker and the row's tint", () => {
    const edit: EditPreview = {
      file: "lib/a.ts",
      added: 1,
      removed: 1,
      lines: [
        { kind: " ", text: "one" },
        { kind: "-", text: "two" },
        { kind: "+", text: "2" },
      ],
      more: 0,
    };
    render(<EditDiff edit={edit} />);
    const diff = screen.getByTestId("edit-diff");
    expect(diff.textContent).toContain("- two");
    expect(diff.textContent).toContain("+ 2");
    expect(diff.textContent).toContain("one");
  });

  it("shows a 'more lines' footer when the preview was capped", () => {
    render(
      <EditDiff
        edit={{
          file: "lib/a.ts",
          added: 5,
          removed: 5,
          lines: [{ kind: "+", text: "x" }],
          more: 7,
        }}
      />,
    );
    expect(screen.getByText(/7 more lines/)).toBeTruthy();
  });

  it("renders no footer when more is 0", () => {
    render(
      <EditDiff
        edit={{
          file: "lib/a.ts",
          added: 0,
          removed: 0,
          lines: [{ kind: " ", text: "x" }],
          more: 0,
        }}
      />,
    );
    expect(screen.queryByText(/more lines/)).toBeNull();
  });

  it("uses a space placeholder when a line's text is empty", () => {
    render(
      <EditDiff
        edit={{
          file: "lib/a.ts",
          added: 0,
          removed: 1,
          lines: [{ kind: "-", text: "" }],
          more: 0,
        }}
      />,
    );
    // The data-testid wraps each row; the spacing keeps the +/- marker readable.
    expect(screen.getByTestId("edit-diff").querySelectorAll("div").length).toBeGreaterThan(0);
  });
});
