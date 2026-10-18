import { describe, expect, it } from "vitest";
import { buildFileIndex, resolveFileRef, splitFileRefs } from "./file-refs";

const FILES = [
  "README.md",
  "docs/README.md",
  "lib/turn.ts",
  "lib/open-file.ts",
  "components/ToolLine.tsx",
  "components/home/route.ts",
  "app/api/cards/[id]/files/route.ts",
  "app/api/cards/[id]/files/routes.test.ts",
  "app/(site)/about/page.tsx",
  "app/(site)/about/README.md",
  "pkg/a/index.ts",
  "pkg/b/index.ts",
];
const index = buildFileIndex(FILES, "/Users/me/app/");

describe("resolveFileRef", () => {
  it("finds an exact relative path, with ./ and a line", () => {
    expect(resolveFileRef(index, "lib/turn.ts")).toEqual({ path: "lib/turn.ts" });
    expect(resolveFileRef(index, "./lib/turn.ts:42")).toEqual({ path: "lib/turn.ts", line: 42 });
    expect(resolveFileRef(index, "lib/turn.ts:42:7")).toEqual({ path: "lib/turn.ts", line: 42 });
  });

  it("makes an absolute path inside the folder relative", () => {
    expect(resolveFileRef(index, "/Users/me/app/lib/open-file.ts")).toEqual({ path: "lib/open-file.ts" });
  });

  it("matches a unique tail or bare name", () => {
    expect(resolveFileRef(index, "ToolLine.tsx")).toEqual({ path: "components/ToolLine.tsx" });
    expect(resolveFileRef(index, "api/cards/[id]/files/route.ts")).toEqual({ path: "app/api/cards/[id]/files/route.ts" });
  });

  it("prefers the root file over an ambiguous tail, and refuses other ambiguity", () => {
    expect(resolveFileRef(index, "README.md")).toEqual({ path: "README.md" });
    expect(resolveFileRef(index, "route.ts")).toBeNull();
    expect(resolveFileRef(index, "index.ts")).toBeNull();
  });

  it("opens a folder's entry file, even written as a URL path", () => {
    expect(resolveFileRef(index, "/api/cards/[id]/files")).toEqual({ path: "app/api/cards/[id]/files/route.ts" });
    expect(resolveFileRef(index, "app/(site)/about/")).toEqual({ path: "app/(site)/about/page.tsx" });
  });

  it("refuses folders with no single entry, missing files and escapes", () => {
    expect(resolveFileRef(index, "index")).toBeNull();
    expect(resolveFileRef(index, "pkg")).toBeNull();
    expect(resolveFileRef(index, "Next.js")).toBeNull();
    expect(resolveFileRef(index, "../secret.ts")).toBeNull();
    expect(resolveFileRef(index, "/")).toBeNull();
  });
});

describe("splitFileRefs", () => {
  it("returns plain text untouched", () => {
    expect(splitFileRefs(index, "Nothing to see in Next.js or weft.zip.")).toEqual(["Nothing to see in Next.js or weft.zip."]);
  });

  it("cuts out mentions and keeps the punctuation around them", () => {
    expect(splitFileRefs(index, "See lib/turn.ts:12, then (ToolLine.tsx).")).toEqual([
      "See ",
      { text: "lib/turn.ts:12", ref: { path: "lib/turn.ts", line: 12 } },
      ", then (",
      { text: "ToolLine.tsx", ref: { path: "components/ToolLine.tsx" } },
      ").",
    ]);
  });

  it("keeps a closing bracket or paren that belongs to the path", () => {
    expect(splitFileRefs(index, "the route at /api/cards/[id]/files.")).toEqual([
      "the route at ",
      { text: "/api/cards/[id]/files", ref: { path: "app/api/cards/[id]/files/route.ts" } },
      ".",
    ]);
    expect(splitFileRefs(index, "lives in app/(site)")).toEqual(["lives in app/(site)"]);
  });

  it("skips URLs and a mention at the very start", () => {
    expect(splitFileRefs(index, "https://x.com/lib/turn.ts")).toEqual(["https://x.com/lib/turn.ts"]);
    expect(splitFileRefs(index, "README.md")).toEqual([{ text: "README.md", ref: { path: "README.md" } }]);
  });
});
