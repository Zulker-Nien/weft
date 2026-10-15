import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Question } from "./types";
import { hasPreviews, previewPage } from "./question-preview";

const opt = (label: string, over: Partial<{ description: string; preview: string }> = {}) => ({
  label,
  description: undefined,
  preview: undefined,
  ...over,
});
const q = (question: string, options: { label: string; description?: string; preview?: string }[]): Question => ({
  question,
  options,
});

describe("hasPreviews", () => {
  it("is true when any option on any question has a preview", () => {
    expect(hasPreviews([q("Q", [opt("A", { preview: "+" })])])).toBe(true);
    expect(hasPreviews([q("Q", [opt("A")]), q("Q2", [opt("B", { preview: "x" })])])).toBe(true);
  });

  it("is false when no option has a preview (including an empty question list)", () => {
    expect(hasPreviews([])).toBe(false);
    expect(hasPreviews([q("Q", [opt("A")])])).toBe(false);
    expect(hasPreviews([q("Q", [opt("A", { description: "d" })])])).toBe(false);
  });
});

describe("previewPage", () => {
  it("escapes the header, question, label, description and preview, and has one section per option with id q-o", () => {
    const html = previewPage([
      { question: "Pick <one> & \"two\"", header: "Head <&>", options: [
        opt('A & <b>', { description: 'd "x" & <y>', preview: "<pre>&" }),
        opt("B", { preview: "  +" }),
      ] },
    ]);
    expect(html).toContain('id="0-0"');
    expect(html).toContain('id="0-1"');
    expect(html).toContain("Head &lt;&amp;&gt;");
    expect(html).toContain("Pick &lt;one&gt; &amp; &quot;two&quot;");
    expect(html).toContain("A &amp; &lt;b&gt;");
    expect(html).toContain('d &quot;x&quot; &amp; &lt;y&gt;');
    expect(html).toContain("&lt;pre&gt;&amp;");
  });

  it("skips the header span when the question has no header, and the description paragraph when there is none", () => {
    const html = previewPage([q("Q?", [opt("A")])]);
    expect(html).toContain('id="0-0"');
    expect(html).toContain("<p class=\"q\">Q?</p>");
    expect(html).not.toContain("<p class=\"q\"><span>");
    expect(html).not.toContain('<p class="d">');
  });

  it("draws a 'No preview for this option.' when the option has no preview", () => {
    const html = previewPage([q("Q", [opt("A")])]);
    expect(html).toContain("<p class=\"none\">No preview for this option.</p>");
  });

  it("draws the dot row with the highlighted option marked on, one dot per option", () => {
    const html = previewPage([q("Q", [opt("A"), opt("B"), opt("C")])]);
    expect(html).toMatch(/<div class="dots"><i class=""><\/i><i class="on"><\/i><i class=""><\/i><\/div>/);
  });
});

// writeQuestionPreview reads DATA_DIR at import time (lib/store.ts). Stub the env and reload the module
// (after mocking ./store) so the file lands in a temp dir, the same way lib/glance.test.ts does.
describe("writeQuestionPreview", () => {
  let dataDir: string;
  let prepped: typeof import("./question-preview");

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-qp-"));
    vi.resetModules();
    vi.stubEnv("THREADBOARD_DATA", dataDir);
    vi.doMock("./store", () => ({ DATA_DIR: dataDir }));
    prepped = await import("./question-preview");
  });
  afterAll(() => {
    for (const m of ["./store"]) vi.doUnmock(m);
    vi.unstubAllEnvs();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    fs.rmSync(path.join(dataDir, "glance"), { recursive: true, force: true });
  });

  it("returns undefined without previews, and writes nothing", () => {
    expect(prepped.writeQuestionPreview("c1", [q("Q", [opt("A")])])).toBeUndefined();
    expect(fs.existsSync(path.join(dataDir, "glance"))).toBe(false);
  });

  it("writes a file URL with one section per option when at least one option has a preview", () => {
    const questions: Question[] = [q("Q", [opt("A", { preview: "+A+" }), opt("B")])];
    const url = prepped.writeQuestionPreview("c1", questions);
    expect(url).toBe(`file://${path.join(dataDir, "glance", "c1-question.html")}`);
    const html = fs.readFileSync(path.join(dataDir, "glance", "c1-question.html"), "utf8");
    expect(html).toContain('id="0-0"');
    expect(html).toContain('id="0-1"');
    expect(html).toContain("+A+");
  });
});
