import { describe, expect, it } from "vitest";
import { migratePrompt, migrateTitle } from "./supabase-migrate";

const owner = { id: "c1", title: "Puku trial", touchedFiles: ["/dev/web/supabase/migrations/20260102000000_trial.sql"], updatedAt: 1 };

describe("migratePrompt", () => {
  it("lists pending migrations with the card that wrote them, and holds writes for an OK", () => {
    const p = migratePrompt({ folder: "/dev/web" }, { ref: "abc", name: "Prod", source: "mcp", pending: ["trial", "relays"], drift: [] }, [owner]);
    expect(p).toContain(`"Prod" (ref abc)`);
    expect(p).toContain("through the Supabase server in .mcp.json");
    expect(p).toContain(`1. trial (written by "Puku trial", card c1)`);
    expect(p).toContain("2. relays\n");
    expect(p).toContain("nothing touches the database until I say so");
    expect(p).toContain("ask me with AskUserQuestion, so I get buttons");
    expect(p).not.toContain("Applied under another version");
  });

  it("lists drifted files with the rename they need, for a CLI link with nothing pending", () => {
    const p = migratePrompt({ folder: "/dev/web" }, { ref: "abc", name: null, source: "cli", pending: null, drift: [{ name: "hooks", local: "1", remote: "2" }] }, []);
    expect(p).toContain("project (ref abc)");
    expect(p).toContain("with the Supabase CLI");
    expect(p).toContain("- hooks: local file 1_hooks.sql, applied as 2");
    expect(p).not.toContain("Not applied yet");
  });

  it("titles the card after the folder", () => {
    expect(migrateTitle({ folder: "/dev/web" })).toBe("Migrate web's Supabase");
  });
});
