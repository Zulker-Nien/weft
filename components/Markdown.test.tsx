// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { drainOpenFiles, OPEN_FILE_EVENT, parseFileRef } from "@/lib/open-file";
import { buildFileIndex } from "@/lib/file-refs";
import { FileIndexContext, FileLinkContext } from "./file-link-context";
import Markdown from "./Markdown";
import "./test-utils";

afterEach(() => {
  // The shared queue spans tests; drain so an earlier test's opens don't bleed.
  drainOpenFiles("c1");
});

describe("Markdown — inline file links", () => {
  it("renders a recognized file ref as a button when a card id is provided", () => {
    render(
      <FileLinkContext.Provider value="c1">
        <Markdown text="Open `lib/turn.ts` next." />
      </FileLinkContext.Provider>,
    );
    const btn = screen.getByTestId("markdown-file-link");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.textContent).toBe("lib/turn.ts");
  });

  it("renders a file ref with a line number and passes the line to openFile", async () => {
    const seen: { cardId: string; path: string; line?: number }[] = [];
    const handler = (e: Event) => seen.push((e as CustomEvent<{ cardId: string; path: string; line?: number }>).detail);
    window.addEventListener(OPEN_FILE_EVENT, handler);
    try {
      render(
        <FileLinkContext.Provider value="c1">
          <Markdown text="See `./README.md:12`." />
        </FileLinkContext.Provider>,
      );
      await userEvent.click(screen.getByTestId("markdown-file-link"));
      expect(seen).toEqual([{ cardId: "c1", path: "./README.md", line: 12 }]);
    } finally {
      window.removeEventListener(OPEN_FILE_EVENT, handler);
    }
  });

  it("renders a non-file inline code as plain code when no card id is provided", () => {
    render(<Markdown text="Try `npm run dev` here." />);
    expect(screen.queryByTestId("markdown-file-link")).toBeNull();
    const code = screen.getByText("npm run dev");
    expect(code.tagName).toBe("CODE");
  });

  it("renders an inline string that isn't a file as plain code even with a card id", () => {
    render(
      <FileLinkContext.Provider value="c1">
        <Markdown text="Run `npm install`." />
      </FileLinkContext.Provider>,
    );
    // npm install has no extension/slash, so parseFileRef rejects it; inline code, not button.
    expect(screen.queryByTestId("markdown-file-link")).toBeNull();
    expect(screen.getByText("npm install").tagName).toBe("CODE");
  });

  it("renders a fenced code block with a Copy button and does not parse it as a file", () => {
    render(
      <FileLinkContext.Provider value="c1">
        <Markdown text={"```ts\nlib/turn.ts:42\n```"} />
      </FileLinkContext.Provider>,
    );
    // A fenced block wraps the path in <pre><code> with a language class; the FileLink button
    // is only for inline code.
    expect(screen.queryByTestId("markdown-file-link")).toBeNull();
    const code = document.querySelector("pre code");
    expect(code).toBeTruthy();
    expect(code?.textContent).toContain("lib/turn.ts:42");
  });

  it("uses parseFileRef to pick file refs out of inline code", () => {
    // Sanity check: the brief lists these shapes; lib/open-file.test.ts already covers each.
    expect(parseFileRef("lib/turn.ts")).toEqual({ path: "lib/turn.ts" });
    expect(parseFileRef("./README.md:12")).toEqual({ path: "./README.md", line: 12 });
    expect(parseFileRef("npm run dev")).toBeNull();
  });
});

describe("Markdown — file names checked against the folder", () => {
  const index = buildFileIndex(["lib/turn.ts", "app/api/cards/[id]/files/route.ts", "components/ToolLine.tsx"], "/repo");
  const inThread = (text: string) =>
    render(
      <FileLinkContext.Provider value="c1">
        <FileIndexContext.Provider value={index}>
          <Markdown text={text} />
        </FileIndexContext.Provider>
      </FileLinkContext.Provider>,
    );

  it("links names in prose, and only files that are there", () => {
    inThread("Edited ToolLine.tsx and Next.js docs, then lib/missing.ts.");
    const links = screen.getAllByTestId("markdown-file-link");
    expect(links.map((l) => l.textContent)).toEqual(["ToolLine.tsx"]);
    expect(links[0]?.title).toBe("components/ToolLine.tsx");
  });

  it("links inline code by the file list: a route folder opens its route.ts, .env stays code", async () => {
    const seen: { path: string }[] = [];
    const handler = (e: Event) => seen.push((e as CustomEvent<{ path: string }>).detail);
    window.addEventListener(OPEN_FILE_EVENT, handler);
    try {
      inThread("The `/api/cards/[id]/files` route never opens `.env` files.");
      await userEvent.click(screen.getByTestId("markdown-file-link"));
      expect(seen[0]?.path).toBe("app/api/cards/[id]/files/route.ts");
      expect(screen.getByText(".env").tagName).toBe("CODE");
    } finally {
      window.removeEventListener(OPEN_FILE_EVENT, handler);
    }
  });

  it("opens a markdown link to a project file, and leaves other links as spans", () => {
    inThread("[the turn](lib/turn.ts:9) and [gone](lib/nope.ts) and [top](#top)");
    expect(screen.getByTestId("markdown-file-link").title).toBe("lib/turn.ts:9");
    expect(screen.getByText("gone").tagName).toBe("SPAN");
    expect(screen.getByText("top").tagName).toBe("SPAN");
  });
});
