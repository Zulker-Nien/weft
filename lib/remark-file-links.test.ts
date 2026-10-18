import { describe, expect, it } from "vitest";
import { buildFileIndex } from "./file-refs";
import { fileHref, parseFileHref, remarkFileLinks } from "./remark-file-links";

const index = buildFileIndex(["lib/turn.ts", "README.md"], "/repo");

describe("file hrefs", () => {
  it("round-trips a path and line", () => {
    expect(parseFileHref(fileHref("app/[id]/route.ts", 3))).toEqual({ path: "app/[id]/route.ts", line: 3 });
    expect(parseFileHref(fileHref("README.md"))).toEqual({ path: "README.md" });
    expect(parseFileHref("https://x.com")).toBeNull();
  });
});

describe("remarkFileLinks", () => {
  it("links mentions in text and leaves links and code alone", () => {
    const tree = {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", value: "Read lib/turn.ts:4 now" }, { type: "text", value: "" }] },
        { type: "paragraph", children: [{ type: "text", value: "plain words" }] },
        { type: "link", url: "x", children: [{ type: "text", value: "README.md" }] },
        { type: "code", value: "README.md" },
      ],
    };
    remarkFileLinks(index)(tree);
    expect(tree.children[0]).toEqual({
      type: "paragraph",
      children: [
        { type: "text", value: "Read " },
        { type: "link", url: "weft-file:lib%2Fturn.ts#L4", children: [{ type: "text", value: "lib/turn.ts:4" }] },
        { type: "text", value: " now" },
        { type: "text", value: "" },
      ],
    });
    expect(tree.children[1]).toEqual({ type: "paragraph", children: [{ type: "text", value: "plain words" }] });
    expect(tree.children[2]).toEqual({ type: "link", url: "x", children: [{ type: "text", value: "README.md" }] });
  });
});
