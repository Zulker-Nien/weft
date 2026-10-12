import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { removeShellToken, SHELL_TOKEN_FILE, writeShellToken } from "./shell-token.cjs";

describe("shell token file", () => {
  it("writes the token readable only by you, replaces it, and removes it", () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "weft-token-")), "nested");
    const file = path.join(dir, SHELL_TOKEN_FILE);
    writeShellToken(dir, "abc");
    expect(fs.readFileSync(file, "utf8")).toBe("abc");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    writeShellToken(dir, "def");
    expect(fs.readFileSync(file, "utf8")).toBe("def");
    expect(fs.readdirSync(dir)).toEqual([SHELL_TOKEN_FILE]);
    removeShellToken(dir);
    expect(fs.existsSync(file)).toBe(false);
    removeShellToken(dir);
  });
});
