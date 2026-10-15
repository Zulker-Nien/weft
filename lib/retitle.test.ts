import { describe, expect, it } from "vitest";
import { nameNeeds, namePrompt, parseName, parseTags, parseTitle, shouldRetitle, shouldTag, STARTER_TAGS, tagPrompt, tagVocabulary, titleEmoji, titlePrompt } from "./retitle";

const card = (over: Partial<Parameters<typeof shouldRetitle>[0]> = {}) => ({ title: "Add login", prompt: "do the thing", ...over });

describe("shouldRetitle", () => {
  it("renames placeholder titles", () => {
    for (const title of ["Image attachment", "image attachment", "Screenshot", "Pasted image", "[Image #1]", "Untitled thread", "New thread", "Look at shot.png", "", "  "]) {
      expect(shouldRetitle(card({ title })), title).toBe(true);
    }
  });

  it("renames a title that is only the prompt's first line", () => {
    expect(shouldRetitle(card({ title: "fix the build", prompt: "fix the build\nit's red" }))).toBe(true);
  });

  it("keeps a real title", () => {
    expect(shouldRetitle(card({ title: "Weft desktop app" }))).toBe(false);
    expect(shouldRetitle(card({ title: "Image compression" }))).toBe(false);
  });

  it("never touches a named card or the copilot", () => {
    expect(shouldRetitle(card({ title: "Image attachment", titleBy: "user" }))).toBe(false);
    expect(shouldRetitle(card({ title: "Image attachment", titleBy: "auto" }))).toBe(false);
    expect(shouldRetitle(card({ title: "Image attachment", role: "copilot" }))).toBe(false);
  });
});

describe("titlePrompt", () => {
  it("carries the ask and reply, clipped", () => {
    const prompt = titlePrompt("[Image #1]", "x".repeat(50_000));
    expect(prompt).toContain('"[Image #1]"');
    expect(prompt.length).toBeLessThan(2_500);
  });
});

describe("shouldTag and nameNeeds", () => {
  it("tags a card with none until you set them, never the copilot", () => {
    expect(shouldTag({})).toBe(true);
    expect(shouldTag({ tags: [], tagsBy: "auto" })).toBe(true);
    expect(shouldTag({ tags: ["bug"] })).toBe(false);
    expect(shouldTag({ tags: [], tagsBy: "user" })).toBe(false);
    expect(shouldTag({ role: "copilot" })).toBe(false);
  });

  it("says what a card still needs", () => {
    expect(nameNeeds(card({ title: "Image attachment" }))).toEqual({ title: true, tags: true });
    expect(nameNeeds({ ...card(), tags: ["ui"] })).toEqual({ title: false, tags: false });
  });
});

describe("tagVocabulary", () => {
  it("puts the catalog first, then the cards' tags by use, deduped and capped at 30", () => {
    const cards = [{ tags: ["ui", "bug"] }, { tags: ["bug"] }, {}];
    expect(tagVocabulary(cards)).toEqual(["bug", "ui"]);
    expect(tagVocabulary(cards, ["Release", "ui", "  "])).toEqual(["release", "ui", "bug"]);
    expect(tagVocabulary([], Array.from({ length: 40 }, (_, i) => `t${String(i)}`))).toHaveLength(30);
  });
});

describe("namePrompt", () => {
  const needs = (title: boolean, tags: boolean) => ({ title, tags });

  it("is today's title prompt when only the title is needed", () => {
    expect(namePrompt(needs(true, false), "ask", "reply", ["bug"])).toBe(titlePrompt("ask", "reply"));
  });

  it("asks only for tags, reusing the board's, when only tags are needed", () => {
    const prompt = namePrompt(needs(false, true), "fix it", "Fixed.", ["bug", "ui"]);
    expect(prompt).toBe(tagPrompt("fix it", "Fixed.", ["bug", "ui"]));
    expect(prompt).toMatch(/^Tag this coding thread with 1 to 3/);
    expect(prompt).toContain("This board already uses: bug, ui.");
    expect(prompt).not.toContain("emoji");
  });

  it("asks for both in two lines, offering starter tags on a board with none", () => {
    const prompt = namePrompt(needs(true, true), "fix it", "Fixed.");
    expect(prompt).toMatch(/^Name this coding thread/);
    expect(prompt).toContain("Title: <emoji> <title>\nTags: <tag>, <tag>");
    expect(prompt).toContain(STARTER_TAGS.join(", "));
    expect(prompt).toContain('"fix it"');
  });
});

describe("parseTags", () => {
  it("reads a Tags line, label markdown and all, normalized and capped at three", () => {
    expect(parseTags("Title: 🐞 Fix\n**Tags:** Bug, #UI; `build`, docs.")).toEqual(["bug", "ui", "build"]);
    expect(parseTags("tags: perf")).toEqual(["perf"]);
  });

  it("reads a bulleted list under an empty Tags line", () => {
    expect(parseTags("Tags:\n- bug\n2. dark mode\nThanks")).toEqual(["bug", "dark mode"]);
    expect(parseTags("Tags:\n- bug\n- ui")).toEqual(["bug", "ui"]);
  });

  it("reads an unlabelled reply only when asked to", () => {
    expect(parseTags('"bug", "ui"')).toEqual(["bug", "ui"]);
    expect(parseTags("bug, ui", false)).toEqual([]);
  });

  it("drops sentences, markup and labels", () => {
    expect(parseTags("Here are some tags:\n<html>, this is far too long, ok")).toEqual(["ok"]);
    expect(parseTags("  \n")).toEqual([]);
  });
});

describe("parseName", () => {
  it("splits a two-line reply into its title and tags", () => {
    expect(parseName("Tags: bug\nTitle: 🐞 Build break.", { title: true, tags: true })).toEqual({ title: "🐞 Build break", tags: ["bug"] });
  });

  it("reads an unlabelled reply as whichever was asked, never a title as tags", () => {
    expect(parseName("🐞 Build break", { title: true, tags: true })).toEqual({ title: "🐞 Build break", tags: [] });
    expect(parseName("bug, ui", { title: false, tags: true })).toEqual({ title: undefined, tags: ["bug", "ui"] });
    expect(parseName("🐞 Build break\nTags: bug", { title: true, tags: false })).toEqual({ title: "🐞 Build break", tags: [] });
  });
});

describe("parseTitle", () => {
  it("takes the first line without quotes or a label", () => {
    expect(parseTitle('"🐞 Compile Error: missing import"')).toBe("🐞 Compile Error: missing import");
    expect(parseTitle("Title: 🐞 Build break.\nmore")).toBe("🐞 Build break");
    expect(parseTitle("\n\n**✨ Polish**")).toBe("✨ Polish");
  });

  it("clips to four words and ends in an ellipsis when longer", () => {
    expect(parseTitle(`🐞 ${"a ".repeat(20).trimEnd()}`)).toBe("🐞 a a a a…");
    expect(parseTitle("🐞 a a a a a a a a a a")).toBe("🐞 a a a a…");
  });

  it("cuts a long single-word title at the byte cap and rejects an empty reply", () => {
    expect(parseTitle(`🐞 ${"a".repeat(100)}`)).toHaveLength(60);
    expect(parseTitle(`🐞 ${"a".repeat(100)}`)!.endsWith("…")).toBe(true);
    expect(parseTitle("  \n ")).toBeUndefined();
  });
});

describe("titleEmoji", () => {
  it("returns the leading emoji only", () => {
    expect(titleEmoji("🐞 Compile Error")).toBe("🐞");
    expect(titleEmoji("Compile 🐞 Error")).toBeUndefined();
  });
});
