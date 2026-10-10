import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { backdropFor, extractHtml, glancePrompt, newThreadPage, shouldWriteGlance, starterPage } from "./glance";

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
    expect(html).not.toContain("say \"hi\" & <script>");
    expect(html).toContain("Working · since 12:05");
  });

  it("draws the card's scene, dimmed, behind a running clock", () => {
    const html = starterPage("Fix", "ask", new Date(2026, 9, 10, 12, 5), "card1");
    expect(html).toMatch(/url\("file:\/\/[^"]*\/assets\/[^"]+\.(jpe?g|png|webp)"\)/);
    expect(html).toContain('id="clock"');
    expect(html).toContain(`const start = ${new Date(2026, 9, 10, 12, 5).getTime()};`);
  });

  it("shows pasted images as thumbnails", () => {
    const html = starterPage("Fix", "![shot.png](/Users/me/.weft/attachments/shot one.png)\n\ncontinue");
    expect(html).toContain('<img src="file:///Users/me/.weft/attachments/shot%20one.png" alt="shot.png">');
    expect(html).not.toContain("![shot.png]");
  });
});

describe("backdropFor", () => {
  it("keeps a card on one scene and spreads cards across them", () => {
    const names = ["a.jpg", "b.jpg", "c.jpg"];
    expect(backdropFor("card1", names)).toBe(backdropFor("card1", names));
    const picked = new Set(Array.from({ length: 30 }, (_, i) => backdropFor(`card-${i}`, names)));
    expect(picked.size).toBe(3);
  });
});

describe("newThreadPage", () => {
  it("is the splash with no ask yet", () => {
    const html = newThreadPage();
    expect(html).toContain("<h1>New thread</h1>");
    expect(html).toContain("Waiting for your prompt…");
    expect(html).not.toContain('class="ask"');
    expect(html).not.toContain('class="recipes"');
  });

  it("offers up to six recipes as weft://recipe links, with their blanks", () => {
    const recipes = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, title: `Recipe <${i}>`, blanks: i === 0 ? [{ name: "product" }] : [] }));
    const html = newThreadPage(recipes);
    expect(html).toContain("or start from a recipe");
    expect(html).toContain('href="weft://recipe/r0"');
    expect(html).toContain("Recipe &lt;0&gt;");
    expect(html).toContain("{product}");
    expect(html).toContain('href="weft://recipe/r5"');
    expect(html).not.toContain('href="weft://recipe/r6"');
  });
});

// The pane side: a fresh copy of the module with the shell, Haiku and the store faked, and its pages
// written to a temp DATA_DIR. The assets folder doesn't exist, so the splash scene is the only backdrop.
describe("pages glance writes and opens in the pane", () => {
  const h = {
    paneUrl: vi.fn<(key: string) => Promise<string | undefined>>(),
    paneThumb: vi.fn<(key: string) => Promise<Buffer | undefined>>(),
    openInPane: vi.fn<(url: string, key: string) => Promise<void>>(async () => {}),
    complete: vi.fn<(prompt: string) => Promise<string>>(),
    getCard: vi.fn<(id: string) => { id: string; title: string; emoji?: string } | undefined>(),
    decorateCard: vi.fn(),
    saveAttachmentData: vi.fn(() => ({ url: "/api/attachments/pane-1.jpg" })),
  };
  let g: typeof import("./glance");
  let dataDir: string;
  const PAGE = "<!doctype html><html><body>update</body></html>";
  const turn = { ask: "Add login", reply: "Added the login page.", openedPane: false, isError: false, stopped: false };
  const opened = () => h.openInPane.mock.calls.map(([url, key]) => [url.replace(`file://${dataDir}`, ""), key]);

  // The thumbnail waits for the page to paint; keep the fake clock moving until the turn's work is done.
  async function settle(p: Promise<unknown>) {
    let done = false;
    void p.finally(() => (done = true));
    for (let i = 0; i < 20 && !done; i++) await vi.advanceTimersByTimeAsync(1200);
    return p;
  }

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-glance-"));
    vi.resetModules();
    vi.stubEnv("WEFT_ASSETS_DIR", path.join(dataDir, "no-assets"));
    vi.doMock("./browser-tools", () => ({ paneUrl: h.paneUrl, paneThumb: h.paneThumb, openInPane: h.openInPane }));
    vi.doMock("./haiku", () => ({ complete: h.complete }));
    vi.doMock("./store", () => ({ DATA_DIR: dataDir, getCard: h.getCard, decorateCard: h.decorateCard }));
    vi.doMock("./attachments", () => ({ saveAttachmentData: h.saveAttachmentData }));
    g = await import("./glance");
  });

  afterAll(() => {
    for (const m of ["./browser-tools", "./haiku", "./store", "./attachments"]) vi.doUnmock(m);
    vi.unstubAllEnvs();
    vi.useRealTimers();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    h.paneUrl.mockResolvedValue("");
    h.paneThumb.mockResolvedValue(undefined);
    h.getCard.mockReturnValue({ id: "c1", title: "Login", emoji: "🔐" });
    h.complete.mockResolvedValue(PAGE);
  });

  it("falls back to the splash scene when the assets folder can't be read", () => {
    expect(g.backdropFor("any-card")).toBe("splash-speeder.jpg");
  });

  it("newThreadUrl writes the New thread page and returns its file url", () => {
    const url = g.newThreadUrl();
    expect(url).toBe(`file://${path.join(dataDir, "glance", "new-thread.html")}`);
    expect(fs.readFileSync(g.glanceFile("new-thread"), "utf8")).toContain("<h1>New thread</h1>");
  });

  describe("showStarter", () => {
    it("opens the starter page in a blank pane", async () => {
      await g.showStarter("c1", "Fix <login>", "make it work");
      expect(opened()).toEqual([["/glance/c1.html", "c1"]]);
      const html = fs.readFileSync(g.glanceFile("c1"), "utf8");
      expect(html).toContain("<h1>Fix &lt;login&gt;</h1>");
      expect(html).toContain("make it work");
    });

    it("leaves a pane that already shows a page, or no desktop app, alone", async () => {
      h.paneUrl.mockResolvedValueOnce("http://localhost:3000/");
      await g.showStarter("c1", "t", "a");
      h.paneUrl.mockResolvedValueOnce(undefined);
      await g.showStarter("c1", "t", "a");
      expect(h.openInPane).not.toHaveBeenCalled();
    });
  });

  describe("glanceAfterTurn", () => {
    it("writes Haiku's update page for a turn that showed nothing and opens it", async () => {
      h.complete.mockResolvedValueOnce("Sure:\n```html\n" + PAGE + "\n```");
      await settle(g.glanceAfterTurn("c1", turn, () => true));
      expect(h.complete).toHaveBeenCalledWith(g.glancePrompt(turn.ask, turn.reply));
      expect(opened()).toEqual([["/glance/c1.html", "c1"]]);
      expect(fs.readFileSync(g.glanceFile("c1"), "utf8")).toBe(PAGE);
    });

    it("writes nothing for an empty reply, a live app in the pane, or a Haiku reply with no page", async () => {
      await settle(g.glanceAfterTurn("c1", { ...turn, reply: "  \n" }, () => true));
      h.paneUrl.mockResolvedValueOnce("https://app.test/");
      await settle(g.glanceAfterTurn("c1", turn, () => true));
      h.complete.mockResolvedValueOnce("I can't write that.");
      await settle(g.glanceAfterTurn("c1", turn, () => true));
      expect(h.openInPane).not.toHaveBeenCalled();
    });

    it("drops the page and the thumbnail when a newer turn started meanwhile", async () => {
      h.paneThumb.mockResolvedValue(Buffer.from("jpg"));
      await settle(g.glanceAfterTurn("c1", turn, () => false));
      expect(h.openInPane).not.toHaveBeenCalled();
      expect(h.paneThumb).not.toHaveBeenCalled();
      expect(h.decorateCard).not.toHaveBeenCalled();
    });

    it("shrugs off a Haiku failure and still captures the thumbnail", async () => {
      h.complete.mockRejectedValueOnce(new Error("rate limited"));
      h.paneThumb.mockResolvedValueOnce(Buffer.from("jpg"));
      await expect(settle(g.glanceAfterTurn("c1", turn, () => true))).resolves.toBeUndefined();
      expect(h.saveAttachmentData).toHaveBeenCalledWith(Buffer.from("jpg"), "pane.jpg", "image/jpeg");
      expect(h.decorateCard).toHaveBeenCalledWith("c1", { thumb: "/api/attachments/pane-1.jpg" });
    });

    it("waits for the page to paint before capturing it", async () => {
      h.paneUrl.mockResolvedValueOnce("https://app.test/");
      const p = g.glanceAfterTurn("c1", turn, () => true);
      await vi.advanceTimersByTimeAsync(1100);
      expect(h.paneThumb).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      await p;
      expect(h.paneThumb).toHaveBeenCalledWith("c1");
    });

    it("does nothing more for a card that's gone", async () => {
      h.getCard.mockReturnValue(undefined);
      await g.glanceAfterTurn("gone", { ...turn, reply: "" }, () => true);
      expect(h.paneThumb).not.toHaveBeenCalled();
      expect(h.complete).not.toHaveBeenCalled();
    });

    it("asks Haiku once for a tile emoji when the card has none, keeping only a real emoji", async () => {
      const emojiReplies = ["Sure! 🔐", "no idea", new Error("down")];
      for (const reply of emojiReplies) {
        h.getCard.mockReturnValue({ id: "c1", title: "Login" });
        h.complete.mockImplementation((prompt) =>
          !prompt.startsWith("Reply with exactly one emoji") ? Promise.resolve(PAGE)
          : reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply));
        await settle(g.glanceAfterTurn("c1", { ...turn, reply: "" }, () => true));
      }
      expect(h.complete).toHaveBeenCalledWith(expect.stringContaining("Task: Login"));
      expect(h.decorateCard.mock.calls).toEqual([["c1", { emoji: "🔐" }]]);
    });
  });
});
