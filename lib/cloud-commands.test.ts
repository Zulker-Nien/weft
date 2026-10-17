import { describe, expect, it } from "vitest";
import { commandText, isOpenCommand, newCardBody, newCardCommand, replyBody, replyCommand, type CloudCommandRow } from "./cloud-commands";
import { CODEX_DEFAULT_MODEL } from "./new-thread";

const target = { orgId: "o1", device: "mac-1", folder: "/dev/app" };

describe("newCardCommand", () => {
  it("is nothing to run without a prompt", () => {
    expect(newCardCommand(target, { prompt: "  \n " })).toBeNull();
  });

  it("addresses the folder on the device, with just the prompt by default", () => {
    expect(newCardCommand(target, { prompt: "  Add dark mode " })).toEqual({
      org_id: "o1",
      kind: "new_card",
      target_device: "mac-1",
      folder: "/dev/app",
      payload: { prompt: "Add dark mode" },
    });
  });

  it("carries the model with the CLI that serves it, and the effort", () => {
    expect(newCardCommand(target, { prompt: "x", model: "claude-opus-5-5", effort: "high" })?.payload).toEqual({
      prompt: "x",
      backend: "claude",
      model: "claude-opus-5-5",
      effort: "high",
    });
    expect(newCardCommand(target, { prompt: "x", model: "opus-4.8" })?.payload).toMatchObject({ backend: "puku", model: "opus-4.8" });
    expect(newCardCommand(target, { prompt: "x", model: CODEX_DEFAULT_MODEL })?.payload).toMatchObject({ backend: "codex", model: CODEX_DEFAULT_MODEL });
  });

  it("leaves out a model no CLI serves and an empty pick", () => {
    expect(newCardCommand(target, { prompt: "x", model: "gpt-9", effort: "" })?.payload).toEqual({ prompt: "x" });
    expect(newCardCommand(target, { prompt: "x", model: "" })?.payload).toEqual({ prompt: "x" });
  });
});

describe("newCardBody", () => {
  it("is the request body of POST /api/cards, in the command's folder", () => {
    expect(newCardBody({ folder: "/dev/app", payload: { prompt: "p", title: "t", backend: "puku", model: "opus-4.8", effort: "low", tags: ["a", "b"] } })).toEqual({
      prompt: "p",
      title: "t",
      backend: "puku",
      model: "opus-4.8",
      effort: "low",
      tags: ["a", "b"],
      cwd: "/dev/app",
    });
  });

  it("carries over only what a card is made from, as the types it must be", () => {
    const payload = { prompt: 4, tags: ["a", 7], permissionMode: "bypassPermissions", cwd: "/etc", start: false } as never;
    const body = newCardBody({ folder: "/dev/app", payload });
    expect(body).toEqual({ prompt: undefined, title: undefined, backend: undefined, model: undefined, effort: undefined, tags: ["a"], cwd: "/dev/app" });
    expect(Object.keys(body)).not.toContain("permissionMode");
  });

  it("copes with a payload that isn't an object", () => {
    expect(newCardBody({ folder: "/dev/app", payload: null as never })).toMatchObject({ prompt: undefined, tags: undefined, cwd: "/dev/app" });
  });
});

describe("isOpenCommand", () => {
  it("is true until the Mac has finished with it", () => {
    const at = (status: CloudCommandRow["status"]) => isOpenCommand({ status });
    expect([at("pending"), at("claimed"), at("done"), at("failed")]).toEqual([true, true, false, false]);
  });
});

describe("replyCommand", () => {
  const to = { ...target, cardId: "c1" };

  it("is nothing to send for an empty reply", () => {
    expect(replyCommand(to, "  \n ")).toBeNull();
  });

  it("addresses the card's Mac and folder, with the card and the trimmed text", () => {
    expect(replyCommand(to, " ship it ")).toEqual({ org_id: "o1", kind: "reply", target_device: "mac-1", folder: "/dev/app", payload: { cardId: "c1", text: "ship it" } });
  });
});

describe("replyBody", () => {
  it("reads the card and the text back", () => {
    expect(replyBody({ payload: { cardId: "c1", text: " hi " } })).toEqual({ cardId: "c1", text: "hi" });
  });

  it("is null when the card or the text is missing or the wrong type", () => {
    expect(replyBody({ payload: { cardId: "c1", text: "  " } })).toBeNull();
    expect(replyBody({ payload: { text: "hi" } as never })).toBeNull();
    expect(replyBody({ payload: { cardId: 4, text: "hi" } as never })).toBeNull();
    expect(replyBody({ payload: null as never })).toBeNull();
  });
});

describe("commandText", () => {
  it("is a new card's prompt or a reply's text", () => {
    expect(commandText({ payload: { prompt: "Add dark mode" } })).toBe("Add dark mode");
    expect(commandText({ payload: { cardId: "c1", text: "go" } })).toBe("go");
    expect(commandText({ payload: {} as never })).toBe("");
  });
});
