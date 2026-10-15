import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-device-id-"));
  process.env.THREADBOARD_DATA = dir;
});
afterEach(() => {
  vi.resetModules();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function load() {
  vi.resetModules();
  return import("./device-id");
}

describe("deviceId", () => {
  it("creates a 64-hex-char id file on first read, mode 0o600, and returns it on every call", async () => {
    const { deviceId, DEVICE_ID_FILE } = await load();
    const id = deviceId();
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.existsSync(DEVICE_ID_FILE)).toBe(true);
    expect(fs.statSync(DEVICE_ID_FILE).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(DEVICE_ID_FILE, "utf8")).toBe(id);
    // A second call returns the same id without re-rolling.
    expect(deviceId()).toBe(id);
  });

  it("returns a fresh id when the file has been removed", async () => {
    const { deviceId, DEVICE_ID_FILE } = await load();
    const first = deviceId();
    fs.rmSync(DEVICE_ID_FILE, { force: true });
    const second = deviceId();
    expect(second).not.toBe(first);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
  });

  it("overwrites a broken (non-hex) file with a fresh id", async () => {
    const { DEVICE_ID_FILE } = await load();
    fs.mkdirSync(path.dirname(DEVICE_ID_FILE), { recursive: true });
    fs.writeFileSync(DEVICE_ID_FILE, "not-a-device-id");
    const { deviceId } = await load();
    const id = deviceId();
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).not.toBe("not-a-device-id");
    expect(fs.readFileSync(DEVICE_ID_FILE, "utf8")).toBe(id);
  });

  it("rejects a 64-char file with non-hex characters and mints a new one", async () => {
    const { DEVICE_ID_FILE } = await load();
    fs.mkdirSync(path.dirname(DEVICE_ID_FILE), { recursive: true });
    // 64 chars but contains 'z' which isn't hex.
    const junk = "z".repeat(64);
    fs.writeFileSync(DEVICE_ID_FILE, junk);
    const { deviceId } = await load();
    const id = deviceId();
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).not.toBe(junk);
    expect(fs.readFileSync(DEVICE_ID_FILE, "utf8")).toBe(id);
  });

  it("rejects a hex string that's the wrong length and mints a new one", async () => {
    const { DEVICE_ID_FILE } = await load();
    fs.mkdirSync(path.dirname(DEVICE_ID_FILE), { recursive: true });
    const short = "abcd1234"; // 8 chars, all hex
    fs.writeFileSync(DEVICE_ID_FILE, short);
    const { deviceId } = await load();
    const id = deviceId();
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).not.toBe(short);
  });

  it("rejects a 64-char file with a trailing newline (after .trim())... well, accepts trimmed content", async () => {
    const { deviceId, DEVICE_ID_FILE } = await load();
    const id = deviceId();
    // Overwrite with a tampered non-hex value plus a trailing newline.
    fs.writeFileSync(DEVICE_ID_FILE, "nope\n");
    const { deviceId: deviceId2 } = await load();
    const next = deviceId2();
    expect(next).toMatch(/^[0-9a-f]{64}$/);
    expect(next).not.toBe(id);
    expect(fs.readFileSync(DEVICE_ID_FILE, "utf8")).toBe(next);
  });

  it("accepts a valid 64-hex file (with trailing whitespace) and keeps it", async () => {
    const { DEVICE_ID_FILE } = await load();
    fs.mkdirSync(path.dirname(DEVICE_ID_FILE), { recursive: true });
    const hex = "a".repeat(64);
    fs.writeFileSync(DEVICE_ID_FILE, hex + "\n");
    const { deviceId } = await load();
    expect(deviceId()).toBe(hex);
  });

  it("uses uppercase-hex check (lowercase only) and mints a new one for uppercase", async () => {
    const { DEVICE_ID_FILE } = await load();
    fs.mkdirSync(path.dirname(DEVICE_ID_FILE), { recursive: true });
    const upper = "A".repeat(64);
    fs.writeFileSync(DEVICE_ID_FILE, upper);
    const { deviceId } = await load();
    const id = deviceId();
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).not.toBe(upper);
  });

  it("rejects an empty file and mints a new one", async () => {
    const { DEVICE_ID_FILE } = await load();
    fs.mkdirSync(path.dirname(DEVICE_ID_FILE), { recursive: true });
    fs.writeFileSync(DEVICE_ID_FILE, "");
    const { deviceId } = await load();
    const id = deviceId();
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.readFileSync(DEVICE_ID_FILE, "utf8")).toBe(id);
  });

  it("first call after rm creates the file with mode 0o600", async () => {
    const { deviceId, DEVICE_ID_FILE } = await load();
    const id = deviceId();
    expect(fs.existsSync(DEVICE_ID_FILE)).toBe(true);
    expect(fs.statSync(DEVICE_ID_FILE).mode & 0o777).toBe(0o600);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("DEVICE_ID_FILE lives under the data dir", async () => {
    const { DEVICE_ID_FILE } = await load();
    expect(DEVICE_ID_FILE).toBe(path.join(dir, "device-id"));
  });
});
