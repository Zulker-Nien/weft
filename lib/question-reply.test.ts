import { describe, expect, it } from "vitest";
import { readQuestionReply } from "./question-reply";

// The reply that goes with a question's answers: per-question notes and previews, or a "Chat about this"
// message. The same logic gates the permission route (app/api/cards/[id]/permission/route.ts) and the
// cloud-inbox answer command (lib/cloud-commands.ts answerBody), so the untrusted body is sanitized
// here once.
describe("readQuestionReply", () => {
  it("returns nothing when the body is empty or has no notes, preview, or chat", () => {
    expect(readQuestionReply({})).toBeUndefined();
    expect(readQuestionReply({ annotations: { q: {} } })).toBeUndefined();
  });

  it("keeps per-question notes (trimmed) and preview (any non-empty string), drops non-strings", () => {
    expect(
      readQuestionReply({ annotations: { q: { notes: "small", preview: "+-+" }, r: { notes: " ", preview: 3 }, s: null, t: "x" } }),
    ).toEqual({ annotations: { q: { notes: "small", preview: "+-+" } } });
  });

  it("returns undefined when annotations end up empty, but keeps a chat", () => {
    expect(readQuestionReply({ annotations: { q: "x" }, chat: "let's talk" })).toEqual({ chat: "let's talk" });
    expect(readQuestionReply({ annotations: { r: {} }, chat: "let's talk" })).toEqual({ chat: "let's talk" });
  });

  it("drops blank chat and non-string chat", () => {
    expect(readQuestionReply({ chat: "   " })).toBeUndefined();
    expect(readQuestionReply({ chat: 4 })).toBeUndefined();
  });

  it("copies annotations and chat through together", () => {
    expect(readQuestionReply({ annotations: { q: { notes: "n", preview: "p" } }, chat: "talk" })).toEqual({
      annotations: { q: { notes: "n", preview: "p" } },
      chat: "talk",
    });
  });
});
