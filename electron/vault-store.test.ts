import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadDeviceKey } from "./device-key.cjs";
import * as sodium from "./vault-crypto.cjs";
import { createVaultStore, tailOf } from "./vault-store.cjs";

// safeStorage stand-in: reversible, but not the identity, so a test can tell the key was wrapped.
const safeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (text: string) => Buffer.from(`wrapped:${text}`),
  decryptString: (buf: Buffer) => buf.toString().replace(/^wrapped:/, ""),
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "weft-vault-"));

beforeAll(() => sodium.ready());

describe("vault crypto", () => {
  it("refuses to run before ready()", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    const fresh = await import("./vault-crypto.cjs");
    expect(() => fresh.newVaultKey()).toThrow(/ready/);
    await fresh.ready();
    await fresh.ready();
    expect(fresh.newVaultKey()).toHaveLength(44);
  });

  it("seals a vault key to a device and binds values to their name and environment", () => {
    const device = sodium.newKeypair();
    const key = sodium.newVaultKey();
    expect(sodium.unwrapKey(sodium.wrapKey(key, device.publicKey), device)).toBe(key);
    expect(() => sodium.unwrapKey(sodium.wrapKey(key, device.publicKey), sodium.newKeypair())).toThrow();

    const box = sodium.encrypt("s3cret-value", key, sodium.aad("github:a/b", "API_KEY", "development", 1));
    expect(sodium.decrypt(box, key, sodium.aad("github:a/b", "API_KEY", "development", 1))).toBe("s3cret-value");
    expect(() => sodium.decrypt(box, key, sodium.aad("github:a/b", "API_KEY", "production", 1))).toThrow();
    expect(() => sodium.decrypt(box, key, sodium.aad("github:a/b", "OTHER", "development", 1))).toThrow();
  });
});

describe("loadDeviceKey", () => {
  it("makes a keypair once, keeps the private half wrapped, and loads it again", () => {
    const dir = tmp();
    const first = loadDeviceKey({ dir: path.join(dir, "sub"), safeStorage: safeStorage(), crypto: sodium });
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "sub", "device-key.json"), "utf8")) as { privateKey: string };
    expect(saved.privateKey).not.toBe(first.privateKey);
    expect(fs.statSync(path.join(dir, "sub", "device-key.json")).mode & 0o777).toBe(0o600);
    expect(loadDeviceKey({ dir: path.join(dir, "sub"), safeStorage: safeStorage(), crypto: sodium })).toEqual(first);
  });

  it("refuses without the Keychain", () => {
    expect(() => loadDeviceKey({ dir: tmp(), safeStorage: safeStorage(false), crypto: sodium })).toThrow(/Keychain/);
  });
});

describe("createVaultStore", () => {
  const make = (dir = tmp(), device = sodium.newKeypair()) => ({ dir, device, store: createVaultStore({ dir, device, sodium, now: () => 0 }) });

  it("shows tails only for long values", () => {
    expect(tailOf("short")).toBe("");
    expect(tailOf("abcdefghijkl")).toBe("ijkl");
  });

  it("writes ciphertext only and lists names with masked tails", () => {
    const { dir, store } = make();
    expect(store.exists("v")).toBe(false);
    expect(store.list("v")).toEqual([]);
    expect(store.get("v", "A", "development")).toBeUndefined();
    store.set("v", "a/b", [
      { name: "API_KEY", environment: "development", value: "sk_test_0123456789", source: ".env.local" }, // gitleaks:allow
      { name: "TODO", environment: "development", value: null, source: ".env.example" },
    ]);
    expect(store.exists("v")).toBe(true);
    const [file] = fs.readdirSync(dir) as [string];
    expect(fs.readFileSync(path.join(dir, file), "utf8")).not.toContain("sk_test_0123456789"); // gitleaks:allow
    expect(store.list("v")).toEqual([
      { name: "API_KEY", environment: "development", missing: false, tail: "6789", updatedAt: "1970-01-01T00:00:00.000Z", source: ".env.local" },
      { name: "TODO", environment: "development", missing: true, tail: "", updatedAt: "1970-01-01T00:00:00.000Z", source: ".env.example" },
    ]);
    expect(store.get("v", "API_KEY", "development")).toBe("sk_test_0123456789"); // gitleaks:allow
    expect(store.get("v", "TODO", "development")).toBeUndefined();
  });

  it("updates in place, never blanks a value with a missing marker, and fills a missing one", () => {
    const { store } = make();
    store.set("v", "v", [{ name: "A", environment: "production", value: "one" }]);
    store.set("v", "v", [
      { name: "A", environment: "production", value: null },
      { name: "M", environment: "production", value: null },
    ]);
    expect(store.get("v", "A", "production")).toBe("one");
    store.set("v", "v", [
      { name: "A", environment: "production", value: "two" },
      { name: "M", environment: "production", value: "filled" },
    ]);
    expect(store.list("v").map((s: { name: string; missing: boolean }) => [s.name, s.missing])).toEqual([
      ["A", false],
      ["M", false],
    ]);
    expect(store.get("v", "A", "production")).toBe("two");
    expect(() => store.set("v", "v", [{ name: "A", environment: "staging", value: "x" }])).toThrow(/staging/);
  });

  it("removes entries", () => {
    const { store } = make();
    expect(store.remove("v", "A", "development")).toBe(false);
    store.set("v", "v", [{ name: "A", environment: "development", value: "x" }]);
    expect(store.remove("v", "B", "development")).toBe(false);
    expect(store.remove("v", "A", "development")).toBe(true);
    expect(store.list("v")).toEqual([]);
  });

  it("opens a vault again from disk with the device key, and refuses another device", () => {
    const { dir, device, store } = make();
    store.set("v", "v", [{ name: "A", environment: "development", value: "kept" }]);
    expect(make(dir, device).store.get("v", "A", "development")).toBe("kept");
    expect(() => make(dir).store.get("v", "A", "development")).toThrow(/no key/);
  });
});
