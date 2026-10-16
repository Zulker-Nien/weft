// Why a tool call is turned away, or null to let it run. Each branch is the
// per-tool check: file tools hit isSecretFile, Grep also checks glob, and Bash
// is a thin wrapper around bashVerdict.

import path from "node:path";
import { DATA_DIR } from "./store";
import { bashVerdict } from "./secret-guard-bash";
import { expandBraces, isSecretFile } from "./secret-guard-files";

// A file:// URL's path, or "" for any other URL.
function filePath(url: string): string {
  if (!/^file:/i.test(url)) return "";
  const bare = url.replace(/^file:(\/\/)?/i, "").replace(/[?#].*$/, "");
  try {
    return decodeURIComponent(bare);
  } catch {
    return bare;
  }
}

const FILE_TOOLS = new Set(["Read", "Edit", "MultiEdit", "NotebookRead", "NotebookEdit"]);

// Why a tool call is turned away, or null to let it run.
export function toolVerdict(toolName: string, input: unknown, dataDir = DATA_DIR): string | null {
  const fields = (input ?? {}) as Record<string, unknown>;
  const str = (key: string) => (typeof fields[key] === "string" ? fields[key] : "");
  if (FILE_TOOLS.has(toolName)) {
    const file = str("file_path") || str("notebook_path");
    return isSecretFile(file, dataDir) ? reason(file) : null;
  }
  switch (toolName) {
    case "Grep":
      // ripgrep's globs match dotfiles, so `*.local` reaches .env.local.
      return hitReason([str("path"), ...expandBraces(str("glob"))].find((p) => p && isSecretFile(p, dataDir, true)));
    case "mcp__browser__open_url": {
      const file = filePath(str("url"));
      return file && isSecretFile(file, dataDir) ? reason(file) : null;
    }
    case "Bash":
      return bashVerdict(str("command"), dataDir);
    default:
      return null;
  }
}

function hitReason(hit: string | undefined): string | null {
  return hit ? reason(hit) : null;
}

// A file is named by its base name; literal text goes in as it is.
function reason(what: string, literal = false): string {
  const name = literal ? what : `\`${path.basename(what.replace(/^["']|["']$/g, ""))}\``;
  return (
    `Weft keeps secret values out of threads, so ${name} can't be read here. Work with names instead: ` +
    "read or edit `.env.example`, and ask the user to set the value themselves."
  );
}
