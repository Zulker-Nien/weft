import { describe, expect, it } from "vitest";
import { chipsFor } from "./copilot-starters";

const reply = {
  chips: [
    { text: "Answer the auth card", project: "/dev/weft", covers: ["Let's commit all the new stuff"] },
    { text: "Sign in to Weft" },
    { text: "Fix the groovenfill deploy", project: "/dev/groovenfill", covers: ["How can I improve my codebase?"] },
    { text: "Commit weft", project: "/dev/weft" },
    { text: "Review weft", project: "/dev/weft" },
    { text: "Review groovenfill", project: "/dev/groovenfill" },
  ],
  covers: ["Let's commit all the new stuff", "How can I improve my codebase?"],
};

describe("chipsFor", () => {
  it("keeps one project's chips plus account-wide ones, and only their covers", () => {
    const { chips, covers } = chipsFor(reply, "/dev/groovenfill");
    expect(chips.map((c) => c.text)).toEqual(["Sign in to Weft", "Fix the groovenfill deploy", "Review groovenfill"]);
    expect([...covers]).toEqual(["How can I improve my codebase?"]);
  });

  it("shows the most urgent four across every project for All", () => {
    const { chips, covers } = chipsFor(reply, null);
    expect(chips.map((c) => c.text)).toEqual(["Answer the auth card", "Sign in to Weft", "Fix the groovenfill deploy", "Commit weft"]);
    expect(covers.size).toBe(2);
  });

  it("falls back to the whole-board covers for chips without their own, and none without chips", () => {
    expect([...chipsFor({ chips: [{ text: "a" }], covers: ["x"] }, null).covers]).toEqual(["x"]);
    expect(chipsFor({ chips: [], covers: ["x"] }, null).covers.size).toBe(0);
  });
});
