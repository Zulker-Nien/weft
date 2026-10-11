import { describe, expect, it } from "vitest";
import { parseTitle, shouldRetitle, titleEmoji, titlePrompt } from "./retitle";

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

describe("parseTitle", () => {
  it("takes the first line without quotes or a label", () => {
    expect(parseTitle('"🐞 Compile Error: missing import"')).toBe("🐞 Compile Error: missing import");
    expect(parseTitle("Title: 🐞 Build break.\nmore")).toBe("🐞 Build break");
    expect(parseTitle("\n\n**✨ Polish**")).toBe("✨ Polish");
  });

  it("cuts a long title and rejects an empty reply", () => {
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
