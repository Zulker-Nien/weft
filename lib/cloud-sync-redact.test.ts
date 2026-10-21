import { describe, expect, it } from "vitest";
import { redactCardRow, redactItemRow, redactOutputRow, redactValue } from "./cloud-sync-redact";
import type { CloudThreadItemRow } from "./cloud-sync-types";
import type { Card, ThreadItem } from "./types";

// Built at run time so the pre-commit secret scan doesn't take the fixture for a real key.
const KEY = ["ghp", "_", "Zx81Qa7Lm2Pw9Rt4Vb6Nc3Hd5Kf0Gj8Ys1Ue"].join("");

describe("cloud sync redaction", () => {
  it("hides a key in a thread item's text and leaves the rest", () => {
    const row = { org_id: "o", card_id: "c", seq: 3, kind: "tool", at: "t", item: { kind: "tool", id: "toolu_1", name: "Bash", result: `token=${KEY}\nok` } } as unknown as CloudThreadItemRow;
    const out = redactItemRow(row);
    expect(JSON.stringify(out)).not.toContain(KEY);
    expect((out.item as Extract<ThreadItem, { kind: "tool" }>).result).toMatch(/^token=‹hidden: .+›\nok$/);
    expect(out).toMatchObject({ org_id: "o", card_id: "c", seq: 3, item: { id: "toolu_1" } });
  });

  it("hides a key in a long tool output", () => {
    expect(redactOutputRow({ org_id: "o", card_id: "c", tool_id: "t", result: `x ${KEY} y`, bytes: 9 }).result).not.toContain(KEY);
  });

  it("hides a key in the card json but keeps its ids and paths", () => {
    const card = { id: "c1", sessionId: "s1", cwd: "/Users/me/dev/app", title: "fix", pending: { input: { command: `curl -H "Authorization: Bearer ${KEY}"` } } } as unknown as Card;
    const out = redactCardRow({ org_id: "o", card_id: "c1", owner_device: "d", folder: "/f", card, deleted: false, updated_at: "t" });
    expect(JSON.stringify(out)).not.toContain(KEY);
    expect(out.card).toMatchObject({ id: "c1", sessionId: "s1", cwd: "/Users/me/dev/app", title: "fix" });
  });

  it("passes numbers, booleans and null through", () => {
    expect(redactValue({ n: 1, b: true, z: null, list: ["plain"] })).toEqual({ n: 1, b: true, z: null, list: ["plain"] });
  });
});
