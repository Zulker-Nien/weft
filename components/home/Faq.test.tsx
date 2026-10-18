// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "../test-utils";
import { FAQ_HIGHLIGHTS, headingId } from "@/lib/faq";
import FaqDoc from "./FaqDoc";
import FaqTeaser from "./FaqTeaser";
import { HomeFooter, HomeNav } from "./HomeChrome";

describe("FaqTeaser", () => {
  it("lists every highlight as a row that links to its full answer", () => {
    render(<FaqTeaser />);
    expect(screen.getAllByText("More")).toHaveLength(FAQ_HIGHLIGHTS.length);
    for (const h of FAQ_HIGHLIGHTS) {
      expect(screen.getByText(h.question)).toBeTruthy();
    }
    const first = FAQ_HIGHLIGHTS[0]!;
    expect(screen.getAllByText("More")[0]?.getAttribute("href")).toBe(`/faq#${headingId(first.question)}`);
    expect(screen.getByText("Read the full FAQ →").getAttribute("href")).toBe("/faq");
  });
});

describe("FaqDoc", () => {
  const md = [
    "# Weft FAQ",
    "",
    "## The basics",
    "",
    "### What is Weft?",
    "",
    "Read the [README](../README.md) or jump to [the basics](#the-basics).",
    "",
    "<p>",
    '<img src="../public/brand/faq/a.png" alt="First" width="32%">',
    '<img src="../public/brand/faq/b.png" alt="Second" width="32%">',
    "</p>",
    "",
    '<img src="../public/brand/faq/c.png" alt="Alone" width="520">',
  ].join("\n");

  it("gives headings GitHub's ids so the contents links land", () => {
    const { container } = render(<FaqDoc markdown={md} />);
    expect(container.querySelector("h2")?.id).toBe("the-basics");
    expect(container.querySelector("h3")?.id).toBe("what-is-weft");
  });

  it("opens repo paths on GitHub and keeps anchors", () => {
    render(<FaqDoc markdown={md} />);
    expect(screen.getByText("README").getAttribute("href")).toMatch(/\/blob\/main\/README\.md$/);
    expect(screen.getByText("the basics").getAttribute("href")).toBe("#the-basics");
  });

  it("draws image rows from the site's /brand folder, side by side or alone", () => {
    const { container } = render(<FaqDoc markdown={md} />);
    expect(container.querySelector(".wz-faqRow")?.querySelectorAll("img")).toHaveLength(2);
    expect(container.querySelector(".wz-faqSolo img")?.getAttribute("src")).toBe("/brand/faq/c.png");
    expect(screen.getByAltText("First")).toBeTruthy();
  });
});

describe("HomeChrome", () => {
  it("links the FAQ from the nav and the footer", () => {
    render(
      <>
        <HomeNav />
        <HomeFooter />
      </>,
    );
    const links = screen.getAllByText("FAQ").map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/faq", "/faq"]);
  });
});
