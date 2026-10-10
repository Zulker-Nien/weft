import { describe, expect, it } from "vitest";
import { NO_DRAG } from "./no-drag";

describe("NO_DRAG", () => {
  it("opts an overlay out of the macOS title-bar drag region", () => {
    expect(NO_DRAG).toEqual({ WebkitAppRegion: "no-drag" });
  });
});
