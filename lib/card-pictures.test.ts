import { describe, expect, it } from "vitest";
import { emojiPrompt, itemPictures, monogram, parseEmoji, picturesPatch, threadPictures } from "./card-pictures";
import type { Card, ThreadItem } from "./types";

const tool = (images?: string[]): ThreadItem => ({ kind: "tool", id: "t", name: "screenshot", summary: "", at: 0, images });
const said = (text: string): ThreadItem => ({ kind: "assistant", text, at: 0 });
const card = (patch: Partial<Card> = {}) => ({ id: "c", pictures: 0, ...patch }) as Card;

describe("itemPictures", () => {
  it("reads a tool's screenshots and the images in a message", () => {
    expect(itemPictures(tool(["/api/attachments/a.png"]))).toEqual(["/api/attachments/a.png"]);
    expect(
      itemPictures(said("Here: ![shot](/Users/me/.weft/attachments/b-1.png) and ![v](/Users/me/.weft/attachments/c-1.mp4)")),
    ).toEqual(["/api/attachments/b-1.png"]);
  });
  it("skips local files outside the attachments folder and non-image items", () => {
    expect(itemPictures(said("![x](/tmp/x.png)"))).toEqual([]);
    expect(itemPictures(tool())).toEqual([]);
  });
});

describe("threadPictures", () => {
  it("counts every picture and keeps the latest", () => {
    expect(threadPictures([tool(["/api/attachments/a.png"]), said("hi"), tool(["/api/attachments/b.png"])])).toEqual({
      pictures: 2,
      thumb: "/api/attachments/b.png",
    });
    expect(threadPictures([])).toEqual({ pictures: 0, thumb: undefined });
  });
});

describe("picturesPatch", () => {
  it("adds a new picture and makes it the thumbnail", () => {
    expect(picturesPatch(card({ pictures: 1, thumb: "/old" }), tool(["/new"]))).toEqual({ pictures: 2, thumb: "/new" });
  });
  it("doesn't count a tool call twice when its result replaces it", () => {
    const before = tool(["/a"]);
    expect(picturesPatch(card({ pictures: 1, thumb: "/a" }), tool(["/a"]), before)).toBeUndefined();
    expect(picturesPatch(card({ pictures: 0 }), tool(["/a"]), tool())).toEqual({ pictures: 1, thumb: "/a" });
  });
  it("is undefined when nothing changed", () => {
    expect(picturesPatch(card(), said("no pictures"))).toBeUndefined();
  });
});

describe("tile fallbacks", () => {
  it("takes the first emoji from Haiku's reply", () => {
    expect(parseEmoji("⌨️")).toBe("⌨️");
    expect(parseEmoji("Sure! 📚 fits")).toBe("📚");
    expect(parseEmoji("no emoji here")).toBeUndefined();
  });
  it("uses the folder's first letter", () => {
    expect(monogram("weft")).toBe("W");
    expect(monogram(".dotfiles")).toBe("D");
    expect(monogram("")).toBe("•");
  });
});

describe("itemPictures in your own messages", () => {
  it("reads images you pasted, including an angle-bracketed path and web URLs", () => {
    const yours: ThreadItem = { kind: "user", text: "![a](</Users/me/.weft/attachments/a-1.png>) ![b](https://x.test/b.webp)", at: 0 };
    expect(itemPictures(yours)).toEqual(["/api/attachments/a-1.png", "https://x.test/b.webp"]);
  });
  it("ignores items that can't hold pictures", () => {
    expect(itemPictures({ kind: "result", text: "![a](https://x.test/a.png)", at: 0 } as unknown as ThreadItem)).toEqual([]);
  });
});

describe("picturesPatch when pictures go away", () => {
  it("counts down and keeps the card's thumbnail when a replacement has fewer pictures", () => {
    expect(picturesPatch(card({ pictures: 2, thumb: "/keep" }), tool(), tool(["/a"]))).toEqual({ pictures: 1, thumb: "/keep" });
  });
  it("starts from 0 on a card that never counted, and never goes below it", () => {
    expect(picturesPatch(card({ pictures: undefined }), tool(["/a"]))).toEqual({ pictures: 1, thumb: "/a" });
    expect(picturesPatch(card({ pictures: undefined }), tool(), tool(["/a", "/b"]))?.pictures).toBe(0);
  });
});

describe("emojiPrompt", () => {
  it("asks Haiku for one emoji for the task", () => {
    expect(emojiPrompt("Fix login")).toBe("Reply with exactly one emoji that best stands for this coding task, and nothing else.\n\nTask: Fix login");
  });
});
