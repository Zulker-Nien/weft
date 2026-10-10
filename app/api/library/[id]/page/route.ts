import fs from "node:fs";
import path from "node:path";
import { connection } from "next/server";
import { guard } from "@/lib/guard";
import { getItem, itemDir, PAGE_HEADERS, recipePage, recipeRuns, withTicks } from "@/lib/library";

// What the browser pane shows for a library item: a recipe's page (its blanks and last runs), or the page a
// to-do or note was saved with, its checkboxes wired to save.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const { id } = await params;
  const item = getItem(id);
  if (!item) return new Response("Not in the library any more.", { status: 404 });
  let html: string;
  if (item.kind === "recipe") {
    html = recipePage(item, recipeRuns(item.id));
  } else {
    try {
      html = withTicks(fs.readFileSync(path.join(itemDir(item), "index.html"), "utf8"), item);
    } catch {
      return new Response("This page wasn't saved.", { status: 404 });
    }
  }
  return new Response(html, { headers: { ...PAGE_HEADERS, "content-type": "text/html; charset=utf-8" } });
}
