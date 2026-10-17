// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { drainOpenFiles, onOpenFile, OPEN_FILE_EVENT, openFile, parseFileRef, type OpenFileRequest } from "./open-file";

afterEach(() => {
  // Each test reaches into the waiting queue; clearing is the only way to keep them isolated.
  drainOpenFiles("c1");
  drainOpenFiles("c2");
  drainOpenFiles("c3");
});

describe("openFile", () => {
  it("dispatches a weft:open-file event with the request as detail", () => {
    const seen: OpenFileRequest[] = [];
    const off = onOpenFile("c1", (r) => seen.push(r));
    openFile({ cardId: "c1", path: "lib/turn.ts", line: 12 });
    expect(seen).toEqual([{ cardId: "c1", path: "lib/turn.ts", line: 12 }]);
    off();
  });

  it("queues requests for editors that mount later, oldest first", () => {
    openFile({ cardId: "c1", path: "a.ts" });
    openFile({ cardId: "c1", path: "b.ts", diff: true });
    openFile({ cardId: "c2", path: "c.ts" });
    const drained = drainOpenFiles("c1");
    expect(drained.map((d) => d.path)).toEqual(["a.ts", "b.ts"]);
    // A second drain is empty: drained requests are removed.
    expect(drainOpenFiles("c1")).toEqual([]);
    // A request for another card sits untouched.
    expect(drainOpenFiles("c2").map((d) => d.path)).toEqual(["c.ts"]);
  });

  it("onOpenFile only fires for its own card", () => {
    const seen: OpenFileRequest[] = [];
    const off = onOpenFile("c1", (r) => seen.push(r));
    openFile({ cardId: "c2", path: "x.ts" });
    expect(seen).toEqual([]);
    off();
  });

  it("returns an unsubscribe that stops the listener", () => {
    const seen: OpenFileRequest[] = [];
    const off = onOpenFile("c1", (r) => seen.push(r));
    off();
    openFile({ cardId: "c1", path: "x.ts" });
    expect(seen).toEqual([]);
  });

  it("exposes the event name for tests to listen to directly", () => {
    expect(OPEN_FILE_EVENT).toBe("weft:open-file");
  });

  it("ignores events with a missing detail", () => {
    const seen: OpenFileRequest[] = [];
    const off = onOpenFile("c1", (r) => seen.push(r));
    window.dispatchEvent(new Event(OPEN_FILE_EVENT));
    expect(seen).toEqual([]);
    off();
  });
});

describe("parseFileRef", () => {
  // Each "accepts" case is what the brief lists as a file reference; each "rejects" is what it
  // lists as not. A relative path with a colon+line is the most common shape; the function
  // also reads dirs and absolute paths with optional line numbers.
  it.each([
    ["lib/turn.ts", { path: "lib/turn.ts" }],
    ["./README.md:12", { path: "./README.md", line: 12 }],
    // Two colons: the first is the line, the second is the (discarded) column — the editor
    // convention. Brief said the line should be 5 and the path `/abs/x.tsx:3`; that interpretation
    // requires the first colon to be part of the filename, which no real reference looks like.
    ["/abs/x.tsx:3:5", { path: "/abs/x.tsx", line: 3 }],
    ["docs/ROADMAP.md", { path: "docs/ROADMAP.md" }],
    ["src/app", { path: "src/app" }],
  ])("reads %s as a file ref", (text, expected) => {
    expect(parseFileRef(text)).toEqual(expected);
  });

  it.each([
    "npm run dev", // a command, not a path
    "foo()", // not a path
    "https://x.com/a.js", // a URL, not a path
    "v1.2.3", // a version
    "0.5", // a number
    "hello", // a single word with no extension or slash
    "", // empty
    "  ", // whitespace only
    "x".repeat(400), // way too long
    "foo bar", // whitespace
  ])("refuses %s", (text) => {
    expect(parseFileRef(text)).toBeNull();
  });
});
