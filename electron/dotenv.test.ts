import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { envFileKind, findEnvFiles, isVercelPull, parseEnv, shortLived } from "./dotenv.cjs";

const values = (text: string) => Object.fromEntries(parseEnv(text).map((e: { name: string; value: string }) => [e.name, e.value]));

describe("parseEnv", () => {
  it("reads plain, exported and commented lines", () => {
    expect(values("# comment\n\nA=1\nexport B = two \nC=three # note\nD=has#hash\nnot a line\n")).toEqual({ A: "1", B: "two", C: "three", D: "has#hash" });
  });

  it("handles quotes, escapes in double quotes and literal single quotes", () => {
    expect(values(`A="x\\ny \\"q\\" \\\\"\nB='a\\nb'\nC=\`tick\`\nD=""`)).toEqual({ A: 'x\ny "q" \\', B: "a\\nb", C: "tick", D: "" });
  });

  it("reads multiline values and keeps ${VAR} references as written", () => {
    expect(values('KEY="-----BEGIN\nline\n-----END"\nURL=${HOST}/api\r\nLAST=1')).toEqual({ KEY: "-----BEGIN\nline\n-----END", URL: "${HOST}/api", LAST: "1" });
  });

  it("takes the rest of the file when a quote never closes", () => {
    expect(values("A='open\nmore")).toEqual({ A: "open\nmore" });
  });

  it("keeps the last value of a repeated name, in its new place", () => {
    expect(parseEnv("A=1\nB=2\nA=3\nB='4'")).toEqual([
      { name: "A", value: "3" },
      { name: "B", value: "4" },
    ]);
  });
});

describe("Vercel pulls", () => {
  it("spots the header and its short-lived values", () => {
    expect(isVercelPull("\n# Created by Vercel CLI\nA=1")).toBe(true);
    expect(isVercelPull("A=1")).toBe(false);
    expect(["VERCEL", "VERCEL_OIDC_TOKEN", "TURBO_CACHE", "NX_DAEMON"].every(shortLived)).toBe(true);
    expect(shortLived("DATABASE_URL")).toBe(false);
  });
});

describe("envFileKind", () => {
  it("maps file names to environments", () => {
    expect(envFileKind(".env.local")).toEqual({ environment: "development", namesOnly: false, ticked: true });
    expect(envFileKind("apps/web/.env.development.local")?.environment).toBe("development");
    expect(envFileKind(".env.development")?.environment).toBe("development");
    expect(envFileKind(".env.production.local")?.environment).toBe("production");
    expect(envFileKind(".env.production")?.environment).toBe("production");
    expect(envFileKind(".env.preview.local")?.environment).toBe("preview");
    expect(envFileKind(".env")).toEqual({ environment: "development", namesOnly: false, ticked: false });
    expect(envFileKind(".env.example")).toEqual({ environment: "development", namesOnly: true, ticked: true });
    expect(envFileKind(".env.test")).toBeNull();
    expect(envFileKind("env.local")).toBeNull();
  });
});

describe("findEnvFiles", () => {
  it("finds files at the root and in apps/* and packages/*", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-dotenv-"));
    for (const f of [".env.local", ".env.example", ".env.test", "README.md", "apps/web/.env.local", "packages/db/.env", "apps/notes.txt"]) {
      fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
      fs.writeFileSync(path.join(root, f), "A=1");
    }
    fs.mkdirSync(path.join(root, ".env.d"));
    expect(findEnvFiles(root)).toEqual([".env.example", ".env.local", "apps/web/.env.local", "packages/db/.env"]);
    expect(findEnvFiles(path.join(root, "nope"))).toEqual([]);
  });
});
