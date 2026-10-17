import { describe, expect, it } from "vitest";
import type { CloudCardRow } from "./cloud-sync-types";
import { cardThumbRefs, withThumbUrls } from "./web-board-thumbs";

const A = `blob:sha256:${"a".repeat(64)}`;
const B = `blob:sha256:${"b".repeat(64)}`;
const row = (id: string, thumb?: string): CloudCardRow => ({
  org_id: "o1",
  card_id: id,
  owner_device: "d",
  folder: "/f",
  card: { id, title: id, prompt: "", cwd: "/f", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, thumb },
  deleted: false,
  updated_at: "",
});

describe("cardThumbRefs", () => {
  it("lists each blob ref thumb once, sorted, and skips URLs and missing thumbs", () => {
    expect(cardThumbRefs([row("1", B), row("2", A), row("3", B), row("4"), row("5", "/api/attachments/x.jpg")])).toEqual([A, B]);
  });
});

describe("withThumbUrls", () => {
  it("swaps a ref with a URL and keeps the rest as they were", () => {
    const rows = [row("1", A), row("2", B), row("3")];
    const out = withThumbUrls(rows, { [A]: "https://signed/a" });
    expect(out[0]?.card.thumb).toBe("https://signed/a");
    expect(rows[0]?.card.thumb).toBe(A);
    expect(out[1]).toBe(rows[1]);
    expect(out[2]).toBe(rows[2]);
  });
});
