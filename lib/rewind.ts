import fs from "node:fs";
import { rewindPoint } from "./edit-last";
import { sessionFiles } from "./import";

// Where to resume a Claude session so it drops the turn `promptId` started (see rewindPoint), read from
// the session's transcript in ~/.claude/projects. Undefined when there's no transcript to read.
export function sessionRewindPoint(sessionId: string, promptId: string) {
  const file = sessionFiles().get(sessionId);
  try {
    return file ? rewindPoint(fs.readFileSync(file, "utf8"), promptId) : undefined;
  } catch {
    return undefined;
  }
}
