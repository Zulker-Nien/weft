import { describe, expect, it } from "vitest";
import { permissionArgs } from "./codex-permissions";

describe("Codex permission arguments", () => {
  it("lets approve-for-me select its own workspace-write sandbox", () => {
    expect(permissionArgs("auto")).toEqual(["--approve-for-me"]);
  });
});
