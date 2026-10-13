import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const config = fs.mkdtempSync(path.join(os.tmpdir(), "weft-cli-defaults-"));
const pukuSettings = path.join(config, "puku-settings.json");
vi.mock("./puku-trial", () => ({ PUKU_SETTINGS: pukuSettings }));

const { defaultEffort, runsOn } = await import("./cli-defaults");

const claudeSettings = path.join(config, "settings.json");

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR;
  fs.rmSync(claudeSettings, { force: true });
  fs.rmSync(pukuSettings, { force: true });
});

describe("defaultEffort", () => {
  it("reads effortLevel from Claude Code's settings in CLAUDE_CONFIG_DIR", () => {
    process.env.CLAUDE_CONFIG_DIR = config;
    fs.writeFileSync(claudeSettings, JSON.stringify({ effortLevel: "xhigh" }));
    expect(defaultEffort("claude")).toBe("xhigh");
  });

  it("reads puku-cli's own settings for a puku thread", () => {
    fs.writeFileSync(pukuSettings, JSON.stringify({ effortLevel: "low" }));
    expect(defaultEffort("puku")).toBe("low");
  });

  it("is undefined with no file, no setting, a null file or a level it doesn't know", () => {
    process.env.CLAUDE_CONFIG_DIR = config;
    expect(defaultEffort("claude")).toBeUndefined();
    fs.writeFileSync(claudeSettings, "null");
    expect(defaultEffort("claude")).toBeUndefined();
    fs.writeFileSync(claudeSettings, JSON.stringify({ effortLevel: "turbo" }));
    expect(defaultEffort("claude")).toBeUndefined();
  });

  it("falls back to ~/.claude when CLAUDE_CONFIG_DIR isn't set", () => {
    const read = vi.spyOn(fs, "readFileSync").mockReturnValueOnce(JSON.stringify({ effortLevel: "max" }));
    expect(defaultEffort("claude")).toBe("max");
    expect(read).toHaveBeenCalledWith(path.join(os.homedir(), ".claude", "settings.json"), "utf8");
    read.mockRestore();
  });
});

describe("runsOn", () => {
  it("pairs the init's model with the card's effort, or the CLI's default", () => {
    process.env.CLAUDE_CONFIG_DIR = config;
    fs.writeFileSync(claudeSettings, JSON.stringify({ effortLevel: "xhigh" }));
    expect(runsOn("claude-opus-5-5", { backend: "claude", effort: "low" })).toEqual({ model: "claude-opus-5-5", effort: "low" });
    expect(runsOn("claude-opus-5-5", { backend: "claude" })).toEqual({ model: "claude-opus-5-5", effort: "xhigh" });
  });

  it("is undefined when the init named no model", () => {
    expect(runsOn(undefined, { backend: "claude" })).toBeUndefined();
  });
});
