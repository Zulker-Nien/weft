// What electron/provider-token.cjs owes the four provider modules it replaced (vercel, supabase,
// cloudflare, blastcp). Their own suites cover what each integration does with the token; these are the
// guarantees the shared module has to keep on its own — the 0600 mode in particular, which nothing
// downstream would notice if it went wrong.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readToken, readTokenRecord, requireKeychain, writeToken, type TokenRecord } from "./provider-token.cjs";

const safeStorage = {
  isEncryptionAvailable: () => true,
  // Marked so a raw read of the file is obvious in a failure: the token must never sit there in plain.
  encryptString: (text: string) => Buffer.from(`w:${text}`),
  decryptString: (buf: Buffer) => buf.toString().slice(2),
};

const dirs: string[] = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-token-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("writeToken", () => {
  it("keeps the token out of the file in plain", () => {
    const file = path.join(tmp(), "token.json");
    writeToken(file, safeStorage, "vc_abc123");
    expect(fs.readFileSync(file, "utf8")).not.toContain("vc_abc123");
    expect(readToken(file, safeStorage)).toBe("vc_abc123");
  });

  it("writes it 0600, so no other account on the Mac can read it", () => {
    const file = path.join(tmp(), "token.json");
    writeToken(file, safeStorage, "vc_abc123");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("is 0600 on every write, not just the first", () => {
    const file = path.join(tmp(), "token.json");
    writeToken(file, safeStorage, "first");
    fs.chmodSync(file, 0o644); // a stray chmod, or a umask shift on a rewrite
    writeToken(file, safeStorage, "second");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("creates the data directory when it's the first file", () => {
    const file = path.join(tmp(), "nested", "token.json");
    expect(fs.existsSync(path.dirname(file))).toBe(false);
    writeToken(file, safeStorage, "t");
    expect(readToken(file, safeStorage)).toBe("t");
  });

  it("stamps savedAt, and merges BlastCP's extra fields beside the token", () => {
    const file = path.join(tmp(), "token.json");
    const saved = writeToken(file, safeStorage, "tok", { expiresAt: "2030-01-01T00:00:00Z", clientId: "cid" });
    expect(saved.token).toBe(Buffer.from("w:tok").toString("base64"));
    expect(saved.expiresAt).toBe("2030-01-01T00:00:00Z");
    expect(saved.clientId).toBe("cid");
    expect(typeof saved.savedAt).toBe("string");
    // Read back from disk, not from writeToken's return: what matters is the file's contents.
    const back = JSON.parse(fs.readFileSync(file, "utf8")) as TokenRecord;
    expect(readTokenRecord(file, safeStorage)).toEqual({ ...back, token: "tok" });
  });
});

describe("readToken", () => {
  it("is null before anything is saved", () => {
    expect(readToken(path.join(tmp(), "token.json"), safeStorage)).toBeNull();
    expect(readTokenRecord(path.join(tmp(), "token.json"), safeStorage)).toBeNull();
  });

  it("throws on a record it can't read, rather than signing the user out silently", () => {
    const file = path.join(tmp(), "token.json");
    fs.writeFileSync(file, "{ truncated");
    expect(() => readToken(file, safeStorage)).toThrow();
  });
});

describe("requireKeychain", () => {
  it("passes when the Keychain is there", () => {
    expect(() => requireKeychain(safeStorage)).not.toThrow();
  });

  it("refuses before anything is written when it isn't", () => {
    expect(() => requireKeychain({ ...safeStorage, isEncryptionAvailable: () => false })).toThrow(/Keychain isn't available/);
  });

  it("names the credential, since that's the only sentence the user sees", () => {
    expect(() => requireKeychain({ ...safeStorage, isEncryptionAvailable: () => false }, "BlastCP sign-in")).toThrow(/keep the BlastCP sign-in safely/);
  });
});