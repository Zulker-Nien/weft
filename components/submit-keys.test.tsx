import { describe, expect, it } from "vitest";
import { isBacklogKey, submitFor } from "./submit-keys";

const enter = { key: "Enter", metaKey: false, ctrlKey: false, shiftKey: false };

describe("submitFor", () => {
  it("ignores every key but Enter", () => {
    expect(submitFor({ ...enter, key: "a", metaKey: true }, "dialog", true, true)).toBeNull();
  });

  it("⌘↵ and Ctrl↵ send; plain Enter in the dialog is a new line", () => {
    expect(submitFor({ ...enter, metaKey: true }, "dialog", true, true)).toBe("submit");
    expect(submitFor({ ...enter, ctrlKey: true }, "dialog", false, true)).toBe("submit");
    expect(submitFor(enter, "dialog", true, true)).toBeNull();
  });

  it("⌃↵ on macOS runs the alternate, when there is one", () => {
    expect(submitFor({ ...enter, ctrlKey: true }, "dialog", true, true)).toBe("alt");
    expect(submitFor({ ...enter, ctrlKey: true, metaKey: true }, "dialog", true, true)).toBe("submit");
  });

  it("off macOS Ctrl↵ is the plain send, alternate or not", () => {
    expect(submitFor({ ...enter, ctrlKey: true }, "dialog", true, false)).toBe("submit");
  });

  it("in a reply Enter sends and Shift+Enter is a new line", () => {
    expect(submitFor(enter, "reply", false, true)).toBe("submit");
    expect(submitFor({ ...enter, shiftKey: true }, "reply", false, true)).toBeNull();
  });
});

describe("isBacklogKey", () => {
  const b = { key: "b", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
  it("is ⌘B on macOS and Ctrl+B elsewhere", () => {
    expect(isBacklogKey({ ...b, metaKey: true }, true)).toBe(true);
    expect(isBacklogKey({ ...b, key: "B", metaKey: true }, true)).toBe(true);
    expect(isBacklogKey({ ...b, ctrlKey: true }, false)).toBe(true);
  });
  it("leaves the other modifiers and keys alone", () => {
    expect(isBacklogKey({ ...b, ctrlKey: true }, true)).toBe(false);
    expect(isBacklogKey({ ...b, metaKey: true }, false)).toBe(false);
    expect(isBacklogKey({ ...b, metaKey: true, shiftKey: true }, true)).toBe(false);
    expect(isBacklogKey({ ...b, metaKey: true, altKey: true }, true)).toBe(false);
    expect(isBacklogKey({ ...b, key: "i", metaKey: true }, true)).toBe(false);
    expect(isBacklogKey(b, true)).toBe(false);
  });
});
