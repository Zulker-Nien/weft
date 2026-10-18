import { folderName } from "./format";
import { migrationOwner, type SupabaseFolder, type SupabaseLink } from "./supabase-view";
import type { Card } from "./types";

// The Supabase drawer's Migrate button (components/SupabaseLinked.tsx): a card that brings the linked project's
// migration history in line with the folder's supabase/migrations. It reviews what's pending, applies it only on
// your OK, and renames any local file Supabase applied under another version, so the drawer reads "all applied".

type Owned = Pick<Card, "id" | "title" | "touchedFiles" | "updatedAt">;

// "the card that wrote it" for a migration, when one on the board did.
function writer(cards: Owned[], folder: string, name: string) {
  const card = migrationOwner(cards, folder, name);
  return card ? ` (written by "${card.title}", card ${card.id})` : "";
}

export function migrateTitle(folder: Pick<SupabaseFolder, "folder">) {
  return `Migrate ${folderName(folder.folder)}'s Supabase`;
}

// The first message of the Migrate card.
export function migratePrompt(folder: Pick<SupabaseFolder, "folder">, link: Pick<SupabaseLink, "ref" | "name" | "source" | "pending" | "drift">, cards: Owned[]) {
  const pending = link.pending ?? [];
  const drift = link.drift ?? [];
  const project = `${link.name ? `"${link.name}" ` : ""}(ref ${link.ref})`;
  const out: string[] = [
    `Bring the Supabase project ${project} in line with the migrations in ${folder.folder}/supabase/migrations.`,
    `The project is linked ${link.source === "mcp" ? "through the Supabase server in .mcp.json" : "with the Supabase CLI (supabase/.temp/project-ref)"}. Treat it as production.`,
    "",
    "Rules: nothing touches the database until I say so. Reading the schema and the migration history is fine; applying, repairing or running any SQL that writes waits for my OK, and so does renaming a file.",
  ];
  if (pending.length) {
    out.push("", "Not applied yet, oldest first:");
    pending.forEach((name, i) => out.push(`${i + 1}. ${name}${writer(cards, folder.folder, name)}`));
  }
  if (drift.length) {
    out.push("", "Applied under another version than the local file's (applying through the MCP stamps its own version), so `supabase db push` would run them again:");
    for (const d of drift) out.push(`- ${d.name}: local file ${d.local}_${d.name}.sql, applied as ${d.remote}`);
  }
  out.push(
    "",
    "How to go:",
    "1. Read the migration history (mcp__supabase__list_migrations when this project's MCP server points at this ref, else `supabase migration list --linked`) and check it against what's listed above; it may have changed since.",
    "2. Read each pending file and check it against the live schema (mcp__supabase__list_tables, read-only SQL): would it fail because something already exists, does it drop or rewrite data, does every new table turn on RLS, does it depend on another pending migration?",
    "3. Write a page in your show folder and open it in the pane, for someone who doesn't read SQL: one plain sentence on the plan at the top, then a card per migration with what it changes for the app, a risk badge (safe, careful, destructive), the order, and the SQL tucked into a closed <details>. List any drifted file with the rename it needs. Then ask me with AskUserQuestion, so I get buttons: apply them all (Recommended, unless one is destructive), or hold.",
    "4. On my OK, apply the pending migrations one at a time, oldest first. Through the MCP, use mcp__supabase__apply_migration with the file's name part (after the version) and its SQL, then read the history for the version Supabase gave it. Through the CLI, `supabase db push`. Stop at the first error and tell me.",
    "5. Make each local file's version match the history: `git mv` supabase/migrations/<local>_<name>.sql to <applied>_<name>.sql, for the ones you applied and the drifted ones above. Don't change a file's SQL.",
    "6. Check the result: the history lists every local file under its own version, and mcp__supabase__get_advisors shows nothing new. Update the page, and tell me to reopen the Supabase drawer, which should read \"all applied\".",
  );
  return out.join("\n");
}
