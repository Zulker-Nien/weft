import { describe, expect, it } from "vitest";
import { extractHtml, glancePrompt, newThreadPage, shouldWriteGlance, starterPage } from "./glance";

describe("extractHtml", () => {
  it("takes the page out of a code fence and chat around it", () => {
    const text = "Here you go:\n```html\n<!doctype html>\n<html><body>hi</body></html>\n```\nEnjoy";
    expect(extractHtml(text)).toBe("<!doctype html>\n<html><body>hi</body></html>");
  });

  it("accepts a page that starts at <html>", () => {
    expect(extractHtml("<html lang=en><p>x</p></html>")).toBe("<html lang=en><p>x</p></html>");
  });

  it("keeps a page cut off before </html>", () => {
    expect(extractHtml("<!DOCTYPE html><p>cut")).toBe("<!DOCTYPE html><p>cut");
  });

  it("is undefined when there's no page", () => {
    expect(extractHtml("Sorry, I can't.")).toBeUndefined();
  });
});

describe("shouldWriteGlance", () => {
  const turn = { openedPane: false, isError: false, stopped: false, paneUrl: "" };

  it("writes when the pane is empty or shows an earlier page file", () => {
    expect(shouldWriteGlance(turn)).toBe(true);
    expect(shouldWriteGlance({ ...turn, paneUrl: "file:///tmp/weft-show/plan.html" })).toBe(true);
  });

  it("leaves a thread's own page and a live app alone", () => {
    expect(shouldWriteGlance({ ...turn, openedPane: true })).toBe(false);
    expect(shouldWriteGlance({ ...turn, paneUrl: "http://localhost:3000/" })).toBe(false);
  });

  it("skips failed and stopped turns, and runs without a desktop shell", () => {
    expect(shouldWriteGlance({ ...turn, isError: true })).toBe(false);
    expect(shouldWriteGlance({ ...turn, stopped: true })).toBe(false);
    expect(shouldWriteGlance({ ...turn, paneUrl: undefined })).toBe(false);
  });
});

describe("glancePrompt", () => {
  it("asks the three questions and carries the ask and reply", () => {
    const prompt = glancePrompt("make it faster", "Cut startup to 2s.");
    expect(prompt).toContain("How's it going?");
    expect(prompt).toContain("What should we do next?");
    expect(prompt).toContain('"make it faster"');
    expect(prompt).toContain("Cut startup to 2s.");
  });

  it("clips a huge reply", () => {
    expect(glancePrompt("x", "y".repeat(50_000)).length).toBeLessThan(15_000);
  });
});

describe("starterPage", () => {
  it("escapes the title and ask", () => {
    const html = starterPage("<b>Fix</b>", 'say "hi" & <script>', new Date(2026, 9, 10, 12, 5));
    expect(html).toContain("&lt;b&gt;Fix&lt;/b&gt;");
    expect(html).toContain("say &quot;hi&quot; &amp; &lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Started 12:05");
  });

  it("uses the splash screen's art", () => {
    const html = starterPage("Fix", "ask");
    expect(html).toMatch(/url\("file:\/\/[^"]*\/assets\/splash-speeder\.jpg"\)/);
    expect(html).toMatch(/src="file:\/\/[^"]*\/assets\/emblem\.png"/);
  });
});

describe("newThreadPage", () => {
  it("is the splash with no ask yet", () => {
    const html = newThreadPage();
    expect(html).toContain("<h1>New thread</h1>");
    expect(html).toContain("Waiting for your prompt…");
    expect(html).not.toContain('class="ask"');
  });
});
