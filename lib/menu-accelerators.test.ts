import { describe, expect, it } from "vitest";
import { withAccelerators } from "./card-menu";

describe("withAccelerators", () => {
  it("adds keys to the matching items only", () => {
    const items = withAccelerators([{ id: "open", label: "Open" }, { type: "separator" }, { id: "rename", label: "Rename" }], {
      open: "Enter",
      rename: undefined,
    });
    expect(items).toEqual([{ id: "open", label: "Open", accelerator: "Enter" }, { type: "separator" }, { id: "rename", label: "Rename" }]);
  });
});
