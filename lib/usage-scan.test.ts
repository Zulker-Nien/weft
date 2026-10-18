import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-usage-"));

vi.mock("./store", () => ({ DATA_DIR: dir }));

const { SCAN_EVERY, TRANSCRIPT_DIRS, USAGE_FILE, addLine, scanUsage, transcriptUsage, transcripts } = await import("./usage-scan");

const at = new Date(2026, 9, 17, 12).getTime();
const projects = path.join(dir, "projects");

const req = (id: string, output: number, day = at) =>
  JSON.stringify({ type: "assistant", requestId: id, timestamp: new Date(day).toISOString(), message: { model: "m", usage: { input_tokens: 1, output_tokens: output } } });
const limit = JSON.stringify({
  type: "assistant", isApiErrorMessage: true, timestamp: new Date(at).toISOString(),
  message: { model: "<synthetic>", content: [{ type: "text", text: "You've hit your session limit · resets 4am" }] },
});

function transcript(name: string, lines: string[], end = "\n") {
  const file = path.join(projects, "-dev-app", `${name}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n") + end);
  return file;
}

let clock = 0;
// Each scan a minute after the last, so none is skipped as too soon.
const scan = (files: string[]) => scanUsage((clock += SCAN_EVERY * 10) + Date.now(), () => files);

function reset() {
  delete (globalThis as Record<string, unknown>).__weftUsage;
  fs.rmSync(USAGE_FILE, { force: true });
  fs.rmSync(projects, { recursive: true, force: true });
}

beforeEach(reset);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("transcripts", () => {
  it("lists every project's transcripts and skips what isn't one", () => {
    const file = transcript("s1", []);
    fs.writeFileSync(path.join(projects, "stray.txt"), "");
    fs.writeFileSync(path.join(projects, "-dev-app", "notes.md"), "");
    expect(transcripts([projects, path.join(dir, "missing")])).toEqual([file]);
    expect(TRANSCRIPT_DIRS).toHaveLength(2);
    expect(transcripts().every((f) => f.endsWith(".jsonl"))).toBe(true);
  });
});

describe("addLine", () => {
  it("counts a request once across its content-block lines", () => {
    const entry = { offset: 0, days: {}, hits: [] };
    for (const line of [req("r1", 5), req("r1", 5), req("r2", 3), "{}", limit]) addLine(entry, line);
    expect(entry).toMatchObject({ last: "r2", days: { "2026-10-17": [2, 8] }, hits: [{ kind: "five_hour", reset: "4am" }] });
  });
});

describe("scanUsage", () => {
  it("reads transcripts, keeps what it found and adds only new lines next time", async () => {
    const file = transcript("s1", [req("r1", 5), limit]);
    await scan([file]);
    expect(transcriptUsage()).toEqual({ tokens: new Map([["2026-10-17", [1, 5]]]), hits: [{ at, kind: "five_hour", reset: "4am" }] });
    expect((JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")) as Record<string, { offset: number }>)[file]?.offset).toBe(fs.statSync(file).size);

    fs.appendFileSync(file, req("r2", 7, at + 86_400_000) + "\n");
    delete (globalThis as Record<string, unknown>).__weftUsage; // a fresh server reads the cache file
    await scan([file, path.join(projects, "gone.jsonl")]);
    expect(transcriptUsage().tokens).toEqual(new Map([["2026-10-17", [1, 5]], ["2026-10-18", [1, 7]]]));
  });

  it("waits for a line to end, and reads a shortened file again", async () => {
    const file = transcript("s1", [req("r1", 5), req("r2", 9)], "");
    await scan([file]);
    expect(transcriptUsage().tokens.get("2026-10-17")).toEqual([1, 5]);
    await scan([file]); // nothing new: the partial line still has no end
    transcript("s1", [req("r", 2)]); // one byte shorter than what was read
    await scan([file]);
    expect(transcriptUsage().tokens.get("2026-10-17")).toEqual([1, 2]);
  });

  it("reads a line longer than a chunk, and a file with no line end yet", async () => {
    const long = JSON.stringify({ type: "user", pad: "x".repeat(1.5 * (1 << 20)) });
    const file = transcript("s1", [long, req("r1", 4)]);
    const open = transcript("s2", [long], "");
    await scan([file, open]);
    expect(transcriptUsage().tokens.get("2026-10-17")).toEqual([1, 4]);
  });

  it("saves as it goes on a big first scan", async () => {
    const files = Array.from({ length: 201 }, (_, i) => transcript(`s${i}`, [req(`r${i}`, 1)]));
    await scan(files);
    expect(transcriptUsage().tokens.get("2026-10-17")).toEqual([201, 201]);
  });

  it("shares a running scan and waits a minute between scans", async () => {
    const file = transcript("s1", [req("r1", 5)]);
    const now = Date.now() + (clock += SCAN_EVERY * 10);
    const a = scanUsage(now, () => [file]);
    expect(scanUsage(now, () => [])).toBe(a);
    await a;
    fs.appendFileSync(file, req("r2", 1) + "\n");
    await scanUsage(Date.now() + 1000, () => [file]);
    expect(transcriptUsage().tokens.get("2026-10-17")).toEqual([1, 5]);
  });

  it("starts empty when the cache file is unreadable", () => {
    fs.writeFileSync(USAGE_FILE, "{oops");
    expect(transcriptUsage()).toEqual({ tokens: new Map(), hits: [] });
  });
});
