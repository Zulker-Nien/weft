import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isPlanTool, planPage, PLAN_TOOL } from "./plan-preview";

describe("isPlanTool", () => {
  it("matches the ExitPlanMode tool name and nothing else", () => {
    expect(isPlanTool(PLAN_TOOL)).toBe(true);
    expect(isPlanTool("AskUserQuestion")).toBe(false);
    expect(isPlanTool("Bash")).toBe(false);
  });
});

describe("planPage", () => {
  it("renders headings, lists and a code block, and escapes user content", () => {
    const html = planPage("## Plan\n\nA <b>step</b> & then:\n\n- one\n- two\n\n1. first\n2. second\n\n```\nplain code\n```\n");
    expect(html).toContain("<h1>Plan</h1>");
    expect(html).toContain("<h2>Plan</h2>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>first</li>");
    expect(html).toContain("<pre><code>plain code</code></pre>");
    expect(html).toContain("A &lt;b&gt;step&lt;/b&gt; &amp; then:");
  });

  it("renders inline bold, code and links safely", () => {
    const html = planPage("Use `lib/foo.ts` and **bold** and [docs](https://x.test).");
    expect(html).toContain("<code>lib/foo.ts</code>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('href="https://x.test"');
  });

  it("keeps an unclosed code fence rendered", () => {
    const html = planPage("```\nnever closed");
    expect(html).toContain("<pre><code>never closed</code></pre>");
  });
});

describe("writePlanPreview", () => {
  let dataDir: string;
  let prepped: typeof import("./plan-preview");

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-pp-"));
    vi.resetModules();
    vi.stubEnv("WEFT_DATA", dataDir);
    vi.doMock("./store", () => ({ DATA_DIR: dataDir }));
    prepped = await import("./plan-preview");
  });
  afterAll(() => {
    vi.doUnmock("./store");
    vi.unstubAllEnvs();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    fs.rmSync(path.join(dataDir, "show"), { recursive: true, force: true });
  });

  it("returns undefined for any other tool", () => {
    expect(prepped.writePlanPreview("c1", "Bash", { command: "ls" })).toBeUndefined();
  });

  it("writes a file URL with the plan rendered for ExitPlanMode", () => {
    const url = prepped.writePlanPreview("c1", PLAN_TOOL, { plan: "# Steps\n- one" });
    expect(url).toBe(`file://${path.join(dataDir, "show", "c1-plan.html")}`);
    const html = fs.readFileSync(path.join(dataDir, "show", "c1-plan.html"), "utf8");
    expect(html).toContain("<h1>Steps</h1>");
    expect(html).toContain("<li>one</li>");
  });

  it("falls back to the raw input JSON when the plan string is empty", () => {
    const url = prepped.writePlanPreview("c1", PLAN_TOOL, { plan: "  " });
    expect(url).toBeTruthy();
    const html = fs.readFileSync(path.join(dataDir, "show", "c1-plan.html"), "utf8");
    expect(html).toContain("&quot;plan&quot;");
  });
});
