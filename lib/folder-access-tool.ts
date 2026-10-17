import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// mcp__board__request_folder_access, in every thread's board tools (lib/board-tools.ts): macOS refuses ~/Downloads (and
// Documents, Desktop) to an app that was never allowed, which shows as "Operation not permitted". Weft asks only when a
// thread calls this (electron/folder-access.cjs): macOS shows its own prompt the first time, and if the answer was
// already No a dialog opens Privacy & Security → Files and Folders. Safe to skip the permission prompt: it only asks the user.
// browser-tools is loaded when the tool runs, so board-tools doesn't pull in its data-folder paths at import.
export function folderAccessTool() {
  return tool(
    "request_folder_access",
    "Ask the user to let Weft read a macOS-protected folder (Downloads, Documents or Desktop). Call it when reading one fails with \"Operation not permitted\", or when the user asks you to use files there; never otherwise. macOS shows its own prompt, or a dialog sends the user to System Settings → Privacy & Security → Files and Folders (Weft needs a restart after they allow it). Tell the user what you asked for and retry the read once they say it's allowed.",
    { folder: z.enum(["downloads", "documents", "desktop"]).describe("The folder you couldn't read") },
    async ({ folder }) => {
      const { shell, text } = await import("./browser-tools");
      try {
        const r = await shell("/folder-access/ask", { folder });
        const app = typeof r.grantee === "string" ? r.grantee : "Weft";
        switch (r.status) {
          case "granted":
            return text(`Weft can already read ${folder}. If a read still fails, restart Weft so its threads pick the access up, then retry.`);
          case "missing":
            return text(`There is no ${folder} folder on this Mac.`);
          case "unsupported":
            return text("macOS folder access only applies on a Mac.");
          case "denied":
            return text(
              r.openedSettings
                ? `macOS is blocking ${folder} for the running app, ${app}. I opened System Settings → Privacy & Security for the user: tell them to turn on “${folder}” (Files and Folders) or Full Disk Access for ${app}, which isn't the same entry as a "Weft" launcher, and restart Weft, then retry.`
                : `macOS is blocking ${folder} and the user chose Not now. Don't ask again this turn; tell them how to allow it (System Settings → Privacy & Security → Files and Folders) or to copy the files somewhere else.`,
            );
          default:
            return text(`Weft can't ask for ${folder}.`, true);
        }
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err), true);
      }
    },
  );
}
