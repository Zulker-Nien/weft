import { describe, expect, it } from "vitest";
import type { Card } from "./types";
import { specFor } from "./runner-state";

// A card's spec is what the SDK's `query()` runs with: cwd, model, mode, read scope. The copilot
// gets one too, with a few fields pinned. Pure mapping; lib/runner-session.ts is where the spec
// turns into SDK options.
describe("specFor", () => {
  it("carries the card's read scope through as the SDK's additionalDirectories source", () => {
    const card: Card = {
      id: "c1",
      title: "T",
      prompt: "do it",
      cwd: "/Users/dev/weft",
      backend: "claude",
      permissionMode: "default",
      column: "backlog",
      createdAt: 0,
      updatedAt: 0,
      readScope: ["/Users/dev/deckcp"],
    };
    const spec = specFor(card);
    expect(spec.readScope).toEqual(["/Users/dev/deckcp"]);
    expect(spec.cwd).toBe("/Users/dev/weft");
  });

  it("drops the read scope when the card has none", () => {
    const card: Card = {
      id: "c1",
      title: "T",
      prompt: "do it",
      cwd: "/Users/dev/weft",
      backend: "claude",
      permissionMode: "default",
      column: "backlog",
      createdAt: 0,
      updatedAt: 0,
    };
    const spec = specFor(card);
    expect(spec.readScope).toBeUndefined();
  });

  it("drops an empty read scope so the SDK doesn't get [].", () => {
    const card: Card = {
      id: "c1",
      title: "T",
      prompt: "do it",
      cwd: "/Users/dev/weft",
      backend: "claude",
      permissionMode: "default",
      column: "backlog",
      createdAt: 0,
      updatedAt: 0,
      readScope: [],
    };
    const spec = specFor(card);
    expect(spec.readScope).toBeUndefined();
  });

  it("pins the copilot's role flag", () => {
    const card: Card = {
      id: "copilot",
      title: "Copilot",
      prompt: "",
      cwd: "/Users/dev/weft",
      backend: "claude",
      permissionMode: "default",
      column: "running",
      createdAt: 0,
      updatedAt: 0,
      role: "copilot",
    };
    expect(specFor(card).copilot).toBe(true);
  });
});
