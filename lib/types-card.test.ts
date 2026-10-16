import { describe, expect, it } from "vitest";
import { MODE_OPTIONS, permissionOptions, toPermissionMode } from "./types-card";

describe("permissionOptions", () => {
  it("offers every mode to Claude", () => {
    expect(permissionOptions("claude")).toEqual(MODE_OPTIONS);
  });

  it("leaves YOLO out for puku", () => {
    expect(permissionOptions("puku").map((m) => m.id)).toEqual(["auto", "acceptEdits", "default"]);
  });

  it("names Codex's four modes in its own words", () => {
    const options = permissionOptions("codex");
    expect(options.map((m) => m.label)).toEqual(["Full access", "Auto review", "Workspace write", "Read only"]);
    expect(options.map((m) => m.id)).toEqual(["bypassPermissions", "auto", "acceptEdits", "default"]);
  });
});

describe("toPermissionMode", () => {
  it("keeps a mode Weft runs", () => {
    expect(toPermissionMode("acceptEdits")).toBe("acceptEdits");
    expect(toPermissionMode("auto")).toBe("auto");
  });

  it("maps plan and dontAsk to the mode that asks", () => {
    expect(toPermissionMode("plan")).toBe("default");
    expect(toPermissionMode("dontAsk")).toBe("default");
  });

  it("returns undefined for anything else", () => {
    expect(toPermissionMode("nope")).toBeUndefined();
    expect(toPermissionMode(undefined)).toBeUndefined();
  });
});
