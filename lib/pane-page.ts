// The page on screen in a card's browser pane, from the index Electron writes on every navigation
// (electron/pane-pages.cjs). A sent message is stamped with it, so the show rail can go back there.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store";

export function panePage(cardId: string): string | undefined {
  try {
    const pages = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "pages", "index.json"), "utf8")) as Record<string, { url?: unknown } | undefined>;
    const url = pages[cardId]?.url;
    return typeof url === "string" && url ? url : undefined;
  } catch {
    return undefined;
  }
}
