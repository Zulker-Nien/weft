import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aliasBases, parseJsonc } from "./ts-paths";

let root: string;

function write(files: Record<string, string>) {
  for (const [rel, src] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), src);
  }
}

const at = (rel: string) => path.join(root, rel);
const tsconfig = (options: object, extra: object = {}) => JSON.stringify({ ...extra, compilerOptions: options });

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ts-paths-")));
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("aliasBases", () => {
  it("maps @/* to ./src/* or ./*, whatever the tsconfig says", () => {
    write({ "tsconfig.json": tsconfig({ paths: { "@/*": ["./src/*"] } }) });
    expect(aliasBases(root, "@/app/x")).toEqual([at("src/app/x")]);
    write({ "tsconfig.json": tsconfig({ paths: { "@/*": ["./*", "./generated/*"] } }) });
    expect(aliasBases(root, "@/app/x")).toEqual([at("app/x"), at("generated/app/x")]);
  });

  it("resolves targets against baseUrl, and handles other patterns, suffixes and exact keys", () => {
    write({ "tsconfig.json": tsconfig({ baseUrl: "./web", paths: { "~/*": ["src/*"], "@ui/*": ["ui/*"], "@ui/icons/*": ["icons/*"], "*.svg": ["assets/*.svg"], config: ["cfg/index.ts"] } }) });
    expect(aliasBases(root, "~/a")).toEqual([at("web/src/a")]);
    expect(aliasBases(root, "@ui/icons/star")).toEqual([at("web/icons/star")]);
    expect(aliasBases(root, "@ui/button")).toEqual([at("web/ui/button")]);
    expect(aliasBases(root, "logo.svg")).toEqual([at("web/assets/logo.svg")]);
    expect(aliasBases(root, "config")).toEqual([at("web/cfg/index.ts")]);
    expect(aliasBases(root, "react")).toBeNull();
    write({ "tsconfig.json": tsconfig({ paths: { "@a/b/*": ["one/*"], "@a/*": ["two/*"] } }) });
    expect(aliasBases(root, "@a/b/x")).toEqual([at("one/x")]);
  });

  it("falls back to the root and then src/ for @/ when no tsconfig paths cover it", () => {
    expect(aliasBases(root, "@/lib/x")).toEqual([at("lib/x"), at("src/lib/x")]);
    expect(aliasBases(root, "react")).toBeNull();
    write({ "tsconfig.json": tsconfig({ paths: { "~/*": ["./*"] } }) });
    expect(aliasBases(root, "@/lib/x")).toEqual([at("lib/x"), at("src/lib/x")]);
    write({ "tsconfig.json": tsconfig({ paths: { "@/*": "./src/*" } }) });
    expect(aliasBases(root, "@/lib/x")).toEqual([at("lib/x"), at("src/lib/x")]);
    write({ "tsconfig.json": tsconfig({ paths: { "@/*": [1] } }) });
    expect(aliasBases(root, "@/lib/x")).toEqual([at("lib/x"), at("src/lib/x")]);
    write({ "tsconfig.json": "{ not json" });
    expect(aliasBases(root, "@/lib/x")).toEqual([at("lib/x"), at("src/lib/x")]);
  });

  it("follows a relative extends for paths, relative to the file that sets them", () => {
    write({ "tsconfig.json": tsconfig({}, { extends: "./config/base" }), "config/base.json": tsconfig({ paths: { "@/*": ["../src/*"] } }) });
    expect(aliasBases(root, "@/x")).toEqual([at("src/x")]);
    write({ "tsconfig.json": tsconfig({}, { extends: "./config/base.json" }) });
    expect(aliasBases(root, "@/x")).toEqual([at("src/x")]);
  });

  it("ignores a package extends and stops an extends loop", () => {
    write({ "tsconfig.json": tsconfig({}, { extends: "@tsconfig/next" }) });
    expect(aliasBases(root, "~/x")).toBeNull();
    write({ "tsconfig.json": tsconfig({}, { extends: "./tsconfig.json" }) });
    expect(aliasBases(root, "~/x")).toBeNull();
  });

  it("rereads a tsconfig once it changes", () => {
    write({ "tsconfig.json": tsconfig({ paths: { "@/*": ["./src/*"] } }) });
    expect(aliasBases(root, "@/x")).toEqual([at("src/x")]);
    expect(aliasBases(root, "@/x")).toEqual([at("src/x")]);
    write({ "tsconfig.json": tsconfig({ paths: { "@/*": ["./app/*"] } }) });
    fs.utimesSync(at("tsconfig.json"), new Date(), new Date(Date.now() + 5000));
    expect(aliasBases(root, "@/x")).toEqual([at("app/x")]);
  });
});

describe("parseJsonc", () => {
  it("drops comments and trailing commas but keeps strings that look like them", () => {
    const text = '{\n  // line\n  "paths": { "@/*": ["./src/*"], }, /* block */\n  "url": "http://x//y",\n}';
    expect(parseJsonc(text)).toEqual({ paths: { "@/*": ["./src/*"] }, url: "http://x//y" });
  });

  it("is null for text that isn't JSON", () => {
    expect(parseJsonc("{ nope")).toBeNull();
  });
});
