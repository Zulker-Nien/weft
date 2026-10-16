import { describe, expect, it } from "vitest";
import type { ThreadItem } from "./types";
import { lastLocalUrl } from "./review-tour";

describe("lastLocalUrl", () => {
  it("returns undefined when no items mention a local URL", () => {
    expect(lastLocalUrl([])).toBeUndefined();
  });

  it("returns undefined when only Weft's own origin is mentioned", () => {
    // In jsdom the test window is http://localhost:3000/, which is what Weft's renderer is on.
    // Anything Weft says about its own address is filtered out.
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const url = origin.replace(/^https?:\/\/localhost/, "http://127.0.0.1");
    const items: ThreadItem[] = [
      { kind: "assistant", text: `Look at ${url}`, at: 1 },
    ];
    expect(lastLocalUrl(items)).toBeUndefined();
  });

  it("returns the most-mentioned local URL (with a trailing slash)", () => {
    const items: ThreadItem[] = [
      { kind: "assistant", text: "open http://localhost:5173", at: 1 },
      { kind: "assistant", text: "see http://localhost:5173 again", at: 2 },
    ];
    expect(lastLocalUrl(items)).toBe("http://localhost:5173/");
  });

  it("counts the pages the thread opened in the pane", () => {
    const items: ThreadItem[] = [
      { kind: "tool", id: "t1", name: "mcp__browser__open_url", summary: "http://localhost:8080/login", at: 1 },
    ];
    expect(lastLocalUrl(items)).toBe("http://localhost:8080/");
  });

  it("ignores addresses in other tools' output, like a grep over test fixtures", () => {
    const grep = Array.from({ length: 12 }, (_, i) => `lib/x.test.ts:${i}: http://127.0.0.1:4567/secrets`).join("\n");
    const items: ThreadItem[] = [
      { kind: "tool", id: "t1", name: "Bash", summary: "grep -rn 127.0.0.1 lib", result: grep, at: 1 },
      { kind: "tool", id: "t2", name: "Bash", summary: "curl http://127.0.0.1:4567", result: "", at: 2 },
      { kind: "assistant", text: "The app is up at http://localhost:5173", at: 3 },
    ];
    expect(lastLocalUrl(items)).toBe("http://localhost:5173/");
  });

  it("ties go to the last seen (>=), not the first", () => {
    const items: ThreadItem[] = [
      { kind: "assistant", text: "http://localhost:4000", at: 1 },
      { kind: "assistant", text: "http://localhost:5000", at: 2 },
    ];
    expect(lastLocalUrl(items)).toBe("http://localhost:5000/");
  });
});