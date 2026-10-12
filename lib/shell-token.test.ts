import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shellToken } from "./shell-token";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("shellToken", () => {
  it("reads the token main wrote, or is empty without one", () => {
    vi.stubEnv("THREADBOARD_SHELL_TOKEN", undefined);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-token-"));
    expect(shellToken(dir)).toBe("");
    fs.writeFileSync(path.join(dir, "shell-token"), "abc\n");
    expect(shellToken(dir)).toBe("abc");
  });

  it("falls back to the env a server from an older main still has", () => {
    vi.stubEnv("THREADBOARD_SHELL_TOKEN", "old");
    expect(shellToken(fs.mkdtempSync(path.join(os.tmpdir(), "weft-token-")))).toBe("old");
  });
});
