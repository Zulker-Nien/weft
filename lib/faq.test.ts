import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FAQ_HIGHLIGHTS, headingId, parseImages, questionCount, splitFaq, textOf, webHref, webSrc } from "./faq";
import { REPO } from "./home";

describe("parseImages", () => {
  it("reads src, alt and width, and skips tags without a src", () => {
    expect(parseImages('<img src="a.png" alt="A" width="32%"> <img alt="none"> <img src="b.svg">')).toEqual([
      { src: "a.png", alt: "A", width: "32%" },
      { src: "b.svg", alt: "" },
    ]);
  });

  it("is empty for text with no images", () => {
    expect(parseImages("just words")).toEqual([]);
  });
});

describe("splitFaq", () => {
  it("cuts <p> image rows and lone <img> lines out of the markdown, in order", () => {
    const md = ["# Title", "", "<p>", '<img src="a.png" alt="A">', '<img src="b.png" alt="B">', "</p>", "", "Text", '<img src="c.png" alt="C" width="520">', "End"].join("\n");
    expect(splitFaq(md)).toEqual([
      { kind: "markdown", text: "# Title\n" },
      { kind: "images", images: [{ src: "a.png", alt: "A" }, { src: "b.png", alt: "B" }] },
      { kind: "markdown", text: "\nText" },
      { kind: "images", images: [{ src: "c.png", alt: "C", width: "520" }] },
      { kind: "markdown", text: "End" },
    ]);
  });

  it("keeps a row that never closes and drops blank markdown between rows", () => {
    expect(splitFaq('<img src="a.png" alt="A">\n\n<p>\n<img src="b.png" alt="B">')).toEqual([
      { kind: "images", images: [{ src: "a.png", alt: "A" }] },
      { kind: "images", images: [{ src: "b.png", alt: "B" }] },
    ]);
  });
});

describe("webSrc", () => {
  it("maps ../public/ to the site root and leaves the rest", () => {
    expect(webSrc("../public/brand/faq/weave.svg")).toBe("/brand/faq/weave.svg");
    expect(webSrc("https://example.com/x.png")).toBe("https://example.com/x.png");
  });
});

describe("webHref", () => {
  it("keeps anchors and absolute links", () => {
    expect(webHref("#the-basics")).toBe("#the-basics");
    expect(webHref("https://puku.sh")).toBe("https://puku.sh");
    expect(webHref("mailto:hi@weft.zip")).toBe("mailto:hi@weft.zip");
  });

  it("opens paths relative to docs/ on GitHub", () => {
    expect(webHref("../README.md")).toBe(`${REPO}/blob/main/README.md`);
    expect(webHref("architecture/secrets.md")).toBe(`${REPO}/blob/main/docs/architecture/secrets.md`);
    expect(webHref("./ROADMAP.md")).toBe(`${REPO}/blob/main/docs/ROADMAP.md`);
  });
});

describe("headingId", () => {
  it("matches GitHub's anchors", () => {
    expect(headingId("Contributing, license and what's next")).toBe("contributing-license-and-whats-next");
    expect(headingId("Accounts, teams and weft.zip")).toBe("accounts-teams-and-weftzip");
    expect(headingId("What is the 🔐 vault?")).toBe("what-is-the--vault");
  });
});

describe("textOf", () => {
  it("flattens strings, numbers, arrays and elements", () => {
    expect(textOf(["Does ", { props: { children: "/weft:done" } }, " force-push?"])).toBe("Does /weft:done force-push?");
    expect(textOf(3)).toBe("3");
    expect(textOf(null)).toBe("");
    expect(textOf({ props: {} })).toBe("");
  });
});

describe("the real FAQ", () => {
  const md = readFileSync(join(process.cwd(), "docs", "FAQ.md"), "utf8");

  it("counts its questions", () => {
    expect(questionCount(md)).toBeGreaterThan(50);
    expect(questionCount("no questions")).toBe(0);
  });

  it("has a heading for every home page highlight, so its link lands", () => {
    const ids = new Set([...md.matchAll(/^### (.+)$/gm)].map((m) => headingId(m[1] ?? "")));
    for (const h of FAQ_HIGHLIGHTS) expect(ids, h.question).toContain(headingId(h.question));
  });

  it("links every table of contents entry to a section heading", () => {
    const ids = new Set([...md.matchAll(/^#{2,3} (.+)$/gm)].map((m) => headingId(m[1] ?? "")));
    for (const [, anchor] of md.matchAll(/\]\(#([^)]+)\)/g)) expect(ids, anchor).toContain(anchor ?? "");
  });

  it("only points images at files that exist", () => {
    const srcs = splitFaq(md).flatMap((s) => (s.kind === "images" ? s.images.map((i) => i.src) : []));
    const inline = [...md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1] ?? "");
    for (const src of [...srcs, ...inline]) expect(() => readFileSync(join(process.cwd(), "docs", src)), src).not.toThrow();
  });
});
