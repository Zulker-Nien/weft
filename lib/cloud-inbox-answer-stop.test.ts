import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { command, control, db, listening, reports, resetInbox } from "./cloud-inbox.harness";
import type { CloudCommandRow } from "./cloud-commands";

vi.mock("./account", async () => (await import("./cloud-inbox.harness")).accountMock);
vi.mock("./settings", async () => (await import("./cloud-inbox.harness")).settingsMock);
vi.mock("./device-id", async () => (await import("./cloud-inbox.harness")).deviceMock);
vi.mock("./cloud-sync", async () => (await import("./cloud-inbox.harness")).cloudSyncMock);
vi.mock("./new-card", async () => (await import("./cloud-inbox.harness")).newCardMock);
vi.mock("./runner", async () => (await import("./cloud-inbox.harness")).runnerMock);
vi.mock("./store", async () => (await import("./cloud-inbox.harness")).storeMock);

const { refreshCloudInbox } = await import("./cloud-inbox");

const run = (row: CloudCommandRow) => {
  db.pending = [row];
  return listening(refreshCloudInbox);
};

beforeEach(() => {
  resetInbox();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  control.cards.set("card-7", { id: "card-7", cwd: "/dev/app" });
});

afterEach(() => vi.restoreAllMocks());

describe("an answer from the web", () => {
  const answer = (over: Partial<CloudCommandRow> = {}, payload: unknown = { cardId: "card-7", pendingId: "p1", allow: true, answers: { q: "a" } }) =>
    command({ id: "cmd-a", kind: "answer", payload: payload as CloudCommandRow["payload"], ...over });

  it("routes to answerPermission with the right allow/answers/pendingId/reply, syncs, and reports done", async () => {
    await run(answer({}, { cardId: "card-7", pendingId: "p1", allow: true, answers: { q: "a" }, reply: { chat: "talk" } }));
    expect(control.answerPermission).toHaveBeenCalledWith("card-7", true, { q: "a" }, "p1", { chat: "talk" });
    expect(control.syncNow).toHaveBeenCalledTimes(1);
    expect(control.made).toEqual([]);
    expect(reports()).toEqual([{ status: "done", card_id: "card-7" }]);
  });

  it("is refused for a card that isn't on this Mac, or not in the command's folder", async () => {
    await run(answer({ id: "cmd-g" }, { cardId: "gone", pendingId: "p1", allow: true }));
    expect(control.answerPermission).not.toHaveBeenCalled();
    expect(reports()[0]?.error).toMatch(/isn't on this Mac/);
    db.updates.length = 0;
    control.cards.set("card-8", { id: "card-8", cwd: "/dev/elsewhere" });
    await run(answer({ id: "cmd-s" }, { cardId: "card-8", pendingId: "p1", allow: true }));
    expect(reports()[0]?.error).toMatch(/isn't on this Mac/);
  });

  it("refuses an empty payload, the copilot, and a permission that isn't waiting any more", async () => {
    await run(answer({}, { cardId: "card-7" }));
    expect(reports()[0]).toMatchObject({ status: "failed", error: "That answer is empty." });
    db.updates.length = 0;
    control.cards.set("copilot", { id: "copilot", cwd: "/dev/app", role: "copilot" });
    await run(answer({ id: "cmd-c" }, { cardId: "copilot", pendingId: "p1", allow: true }));
    expect(reports()[0]?.error).toMatch(/copilot/);
    db.updates.length = 0;
    control.answerPermission.mockImplementationOnce(() => {
      throw new Error("That request isn't waiting anymore.");
    });
    await run(answer({ id: "cmd-w" }));
    expect(reports()[0]).toMatchObject({ status: "failed" });
    expect(reports()[0]?.error).toMatch(/isn't waiting/);
  });

  it("is held to the same checks as a new card: folder, workspace, author", async () => {
    await run(answer({ folder: "/dev/other" }));
    expect(reports()[0]?.error).toMatch(/Settings → Sync/);
    expect(control.answerPermission).not.toHaveBeenCalled();
  });
});

describe("a stop from the web", () => {
  const stop = (over: Partial<CloudCommandRow> = {}, payload: unknown = { cardId: "card-7" }) =>
    command({ id: "cmd-s", kind: "stop", payload: payload as CloudCommandRow["payload"], ...over });

  it("awaits runner.stop on the card, syncs, and reports done", async () => {
    await run(stop());
    expect(control.stop).toHaveBeenCalledWith("card-7");
    expect(control.syncNow).toHaveBeenCalledTimes(1);
    expect(reports()).toEqual([{ status: "done", card_id: "card-7" }]);
  });

  it("is refused for a card that isn't on this Mac, or not in the command's folder", async () => {
    await run(stop({ id: "cmd-g" }, { cardId: "gone" }));
    expect(control.stop).not.toHaveBeenCalled();
    expect(reports()[0]?.error).toMatch(/isn't on this Mac/);
    db.updates.length = 0;
    control.cards.set("card-8", { id: "card-8", cwd: "/dev/elsewhere" });
    await run(stop({ id: "cmd-s" }, { cardId: "card-8" }));
    expect(reports()[0]?.error).toMatch(/isn't on this Mac/);
  });

  it("refuses an empty payload and the copilot", async () => {
    await run(stop({}, { cardId: "" }));
    expect(reports()[0]).toMatchObject({ status: "failed", error: "That stop is missing the card." });
    db.updates.length = 0;
    control.cards.set("copilot", { id: "copilot", cwd: "/dev/app", role: "copilot" });
    await run(stop({ id: "cmd-c" }, { cardId: "copilot" }));
    expect(reports()[0]?.error).toMatch(/copilot/);
  });

  it("is held to the same checks as a new card: folder, workspace, author", async () => {
    await run(stop({ folder: "/dev/other" }));
    expect(reports()[0]?.error).toMatch(/Settings → Sync/);
    expect(control.stop).not.toHaveBeenCalled();
  });
});
