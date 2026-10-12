import { execFileSync } from "node:child_process";
import type { Backend } from "./types";

let pukuPath: string | undefined;

// The CLI binary a thread's backend runs: the SDK's own Claude Code, or puku-cli found on the PATH once.
export function executableFor(backend: Backend) {
  if (backend !== "puku") return undefined;
  if (!pukuPath) {
    try {
      pukuPath = execFileSync("/usr/bin/which", ["puku-cli"], { encoding: "utf8" }).trim();
    } catch {
      throw new Error("puku-cli isn't on this app's PATH.");
    }
  }
  return pukuPath;
}
