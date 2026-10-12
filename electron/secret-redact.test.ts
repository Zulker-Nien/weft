import { describe, expect, it } from "vitest";
import { formsOf, redactor } from "./secret-redact.cjs";

const PASS = "s3cr3t p@ss/word+x";

describe("redactor", () => {
  it("swaps a value as written for ‹NAME›", () => {
    const redact = redactor([{ name: "DB_PASS", value: PASS }]);
    expect(redact(`password is ${PASS}, again ${PASS}`)).toBe("password is ‹DB_PASS›, again ‹DB_PASS›");
    expect(redact(undefined as unknown as string)).toBe("");
  });

  it("catches the URL-encoded, form-encoded, lowercase-hex and JSON-escaped forms", () => {
    const redact = redactor([{ name: "P", value: PASS }]);
    expect(redact(`postgres://u:${encodeURIComponent(PASS)}@h/db`)).toBe("postgres://u:‹P›@h/db");
    expect(redact(`q=${encodeURIComponent(PASS).replace(/%20/g, "+")}`)).toBe("q=‹P›");
    expect(redact(encodeURIComponent(PASS).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()))).toBe("‹P›");
    const quoted = 'say "hi"\\now';
    expect(redactor([{ name: "Q", value: quoted }])(JSON.stringify({ v: quoted }))).toBe('{"v":"‹Q›"}');
  });

  it("catches base64 of the value, alone or inside a longer string, standard and url-safe", () => {
    const redact = redactor([{ name: "P", value: PASS }]);
    expect(redact(`Basic ${Buffer.from(PASS).toString("base64")}`)).toBe("Basic ‹P›");
    for (const prefix of ["u:", "us:", "use:"]) {
      const encoded = Buffer.from(`${prefix}${PASS}!tail`).toString("base64");
      expect(redact(encoded)).toContain("‹P›");
      const safe = Buffer.from(`${prefix}${PASS}!tail`).toString("base64url");
      expect(redact(safe)).toContain("‹P›");
    }
  });

  it("leaves very short values alone, and longer names win over their prefixes", () => {
    expect(formsOf("abc")).toEqual([]);
    expect(formsOf(undefined as unknown as string)).toEqual([]);
    const redact = redactor([
      { name: "SHORT", value: "abcd1234" },
      { name: "LONG", value: "abcd1234-and-more" },
    ]);
    expect(redact("abcd1234-and-more / abcd1234")).toBe("‹LONG› / ‹SHORT›");
    expect(redact("nothing here")).toBe("nothing here");
  });
});
