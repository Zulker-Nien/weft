import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pane-page-"));
vi.mock("./store", () => ({ DATA_DIR: dir }));
const { panePage } = await import("./pane-page");

const write = (body: string) => {
  fs.mkdirSync(path.join(dir, "pages"), { recursive: true });
  fs.writeFileSync(path.join(dir, "pages", "index.json"), body);
};

describe("panePage", () => {
  afterEach(() => fs.rmSync(path.join(dir, "pages"), { recursive: true, force: true }));

  it("reads the card's page from the pane's index", () => {
    write(JSON.stringify({ c1: { url: "http://localhost:3000/a" }, c2: { url: "" }, c3: { url: 4 } }));
    expect(panePage("c1")).toBe("http://localhost:3000/a");
    expect(panePage("c2")).toBeUndefined();
    expect(panePage("c3")).toBeUndefined();
    expect(panePage("nope")).toBeUndefined();
  });

  it("gives nothing when there's no index or it doesn't parse", () => {
    expect(panePage("c1")).toBeUndefined();
    write("{");
    expect(panePage("c1")).toBeUndefined();
  });
});
