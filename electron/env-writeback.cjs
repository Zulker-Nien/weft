// .env.local written back from the vault (docs/architecture/secrets.md, "After import: the file stays, managed by
// Weft"). `next dev`, Prisma and your own scripts read the file directly, so the vault stays the source of truth
// and Weft writes the file out under a header. A watcher notices hand edits, and the drawer's nudge offers to
// import them. Weft only takes over a file it can rewrite without losing a value the vault doesn't hold.
const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("./dotenv.cjs");

const MANAGED_FILE = ".env.local";
const HEADER = "# Managed by Weft: the 🔐 vault holds these values and Weft rewrites this file from it.";
const HEADER_NOTE = "# Edit it if you like: Weft notices and offers to import your changes into the vault.";
// A hand edit lands as several events in a row; one look after they settle is enough.
const SETTLE_MS = 250;

const isManaged = (text) => typeof text === "string" && text.startsWith("# Managed by Weft");

// Plain when it's safe unquoted, otherwise double quotes with the escapes parseEnv reads back.
function quote(value) {
  if (/^[\w@%+=:,./~^-]*$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}"`;
}

// The file's text: the header, then each name in order. A name still missing a value is a comment, so the
// file says what's missing without setting it to "".
function renderEnv(entries) {
  const lines = [HEADER, HEADER_NOTE, ""];
  for (const { name, value } of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(value === null ? `# ${name}= (missing: fill it in with 🔐 in Weft)` : `${name}=${quote(value)}`);
  }
  return lines.join("\n") + "\n";
}

// Whether Weft may write the file: never one git tracks, and never over values the vault doesn't hold.
// current is the file's text, or null when there's none. values maps name to the vault's value.
function planWrite({ current, values, tracked }) {
  if (tracked) return { ok: false, reason: `git tracks ${MANAGED_FILE}, so its values are in history: untrack it and rotate them first.` };
  if (current === null || isManaged(current)) return { ok: true };
  const pending = parseEnv(current)
    .filter((e) => values.get(e.name) !== e.value)
    .map((e) => e.name);
  if (!pending.length) return { ok: true };
  return { ok: false, pending, reason: `${pending.length} value${pending.length === 1 ? "" : "s"} in ${MANAGED_FILE} ${pending.length === 1 ? "isn't" : "aren't"} in the vault yet (${pending.join(", ")}): import ${pending.length === 1 ? "it" : "them"} first.` };
}

// Replaces the file in one step, readable only by you.
function writeFileAtomic(file, text) {
  const tmp = `${file}.${process.pid}.weft-tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

function readOrNull(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

// Adds .env*.local to the folder's .gitignore, keeping what's there.
function ignoreLocalEnv(folder) {
  const file = path.join(folder, ".gitignore");
  const current = readOrNull(file) ?? "";
  const gap = current === "" || current.endsWith("\n") ? "" : "\n";
  fs.writeFileSync(file, `${current}${gap}# Local env files (Weft writes .env.local from its vault)\n.env*.local\n`);
}

// Watches managed files and calls onEdit(folder) when one changes into something Weft didn't write. It watches
// the folder, not the file: Weft's own write renames a new file into place, which a watch on the old one misses.
function createEnvWatcher({ onEdit, watch = fs.watch, setTimer = setTimeout, clearTimer = clearTimeout, settleMs = SETTLE_MS }) {
  const watched = new Map(); // file -> { watcher, written, timer, folder }

  function look(entry, file) {
    entry.timer = null;
    const text = readOrNull(file);
    if (text !== null && text !== entry.written) onEdit(entry.folder);
  }

  return {
    // Remembers what Weft just wrote, so its own write isn't taken for an edit.
    wrote(folder, text) {
      const file = path.join(folder, MANAGED_FILE);
      const entry = watched.get(file);
      if (entry) {
        entry.written = text;
        return;
      }
      const next = { folder, written: text, timer: null, watcher: null };
      try {
        next.watcher = watch(folder, (_event, name) => {
          if (name && String(name) !== MANAGED_FILE) return;
          if (next.timer) clearTimer(next.timer);
          next.timer = setTimer(() => look(next, file), settleMs);
        });
      } catch {
        return;
      }
      watched.set(file, next);
    },
    watching: (folder) => watched.has(path.join(folder, MANAGED_FILE)),
    close() {
      for (const entry of watched.values()) {
        if (entry.timer) clearTimer(entry.timer);
        entry.watcher.close();
      }
      watched.clear();
    },
  };
}

module.exports = { MANAGED_FILE, HEADER, isManaged, quote, renderEnv, planWrite, writeFileAtomic, ignoreLocalEnv, createEnvWatcher, readOrNull };
