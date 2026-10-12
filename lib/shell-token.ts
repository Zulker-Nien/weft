import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store";

// The token for Electron main's control server, which main writes to the data folder each launch
// (electron/shell-token.cjs) instead of putting it in the server's env, where any process of yours
// could read it. Read on each use: it's tiny, and a relaunch replaces it. "" outside the desktop app.
// A server started by an older main still has it in its env until Weft restarts.
export function shellToken(dataDir = DATA_DIR): string {
  try {
    return fs.readFileSync(path.join(dataDir, "shell-token"), "utf8").trim();
  } catch {
    return process.env.THREADBOARD_SHELL_TOKEN ?? "";
  }
}
