// Reads the tail of a log file. Used by the dev server supervisor (electron/server.cjs) to classify
// the cause of a crash, and by the runtime fatal bar (electron/server-ipc.cjs) to show the user the
// last few KB when they hit "Fix with a thread". Kept tiny so both callers can import it without
// pulling in the supervisor's spawn/port logic.
const fs = require("node:fs");

const TAIL_BYTES = 4 * 1024;

/** The last 4 KB of `file` decoded as utf8, or "" if the file is missing or unreadable. */
function readTail(file) {
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - TAIL_BYTES);
    const fd = fs.openSync(file, "r");
    try {
      const len = stat.size - start;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      return buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

module.exports = { readTail, TAIL_BYTES };
