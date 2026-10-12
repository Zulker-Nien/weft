import { describe, expect, it, vi } from "vitest";
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import { attribution } from "./attribution";
import { switchSpare } from "./spare-switch";

const cli = () => ({ setPermissionMode: vi.fn(async () => {}), setModel: vi.fn(async () => {}), applyFlagSettings: vi.fn(async () => {}) });
const spec = () => ({ backend: "claude" as const, copilot: false, permissionMode: "acceptEdits" as const });

describe("switchSpare", () => {
  it("switches the spare to the card's mode, model and effort and signs as that model", () => {
    const q = cli();
    const s = spec();
    switchSpare(q as unknown as Query, s, { permissionMode: "default", model: "claude-opus-5-5", effort: "low" });
    expect(s).toMatchObject({ permissionMode: "default", model: "claude-opus-5-5", effort: "low" });
    expect(q.setPermissionMode).toHaveBeenCalledWith("default");
    expect(q.setModel).toHaveBeenCalledWith("claude-opus-5-5");
    expect(q.applyFlagSettings).toHaveBeenCalledWith({ attribution: attribution("claude-opus-5-5") });
    expect(q.applyFlagSettings).toHaveBeenCalledWith({ effortLevel: "low" });
  });

  it("leaves a spare that already matches alone, and survives a spare with no CLI yet", () => {
    const q = cli();
    switchSpare(q as unknown as Query, spec(), { permissionMode: "acceptEdits" });
    expect(q.setPermissionMode).not.toHaveBeenCalled();
    expect(q.setModel).not.toHaveBeenCalled();
    expect(q.applyFlagSettings).not.toHaveBeenCalled();
    expect(() => switchSpare(undefined, spec(), { permissionMode: "default", model: "sonnet", effort: "high" })).not.toThrow();
  });
});
