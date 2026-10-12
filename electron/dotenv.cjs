// Reads a project's .env files for the vault's import (docs/architecture/secrets.md, "Importing .env files").
// Electron main reads them, never an agent, so values go from the disk straight into the vault. The parser
// handles quotes, multiline values and `export` prefixes, and keeps `${VAR}` references as written.
const fs = require("node:fs");
const path = require("node:path");

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/;
const ESCAPES = { n: "\n", r: "\r", t: "\t" };

// Entries in file order; a name given twice keeps its last value, as dotenv does.
function parseEnv(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const values = new Map();
  for (let i = 0; i < lines.length; i++) {
    const match = LINE.exec(lines[i]);
    if (!match) continue;
    const [, name, rest] = match;
    const quote = rest[0];
    if (quote === '"' || quote === "'" || quote === "`") {
      // Read up to the closing quote, across lines if it's not on this one.
      let body = rest.slice(1);
      let end = closing(body, quote);
      while (end < 0 && i + 1 < lines.length) {
        body += "\n" + lines[++i];
        end = closing(body, quote);
      }
      const raw = end < 0 ? body : body.slice(0, end);
      values.delete(name);
      values.set(name, quote === '"' ? raw.replace(/\\([nrt"\\])/g, (_, c) => ESCAPES[c] ?? c) : raw);
    } else {
      values.delete(name);
      values.set(name, rest.replace(/\s+#.*$/, "").trim());
    }
  }
  return [...values].map(([name, value]) => ({ name, value }));
}

function closing(body, quote) {
  for (let i = 0; i < body.length; i++) {
    if (quote === '"' && body[i] === "\\") i++;
    else if (body[i] === quote) return i;
  }
  return -1;
}

// `vercel env pull` writes this header, along with system values that change on every pull.
const VERCEL_HEADER = /^#\s*Created by Vercel CLI/;
const VERCEL_SHORT_LIVED = /^(VERCEL|VERCEL_[A-Z_]+|TURBO_[A-Z_]+|NX_DAEMON)$/;

function isVercelPull(text) {
  return VERCEL_HEADER.test(text.trimStart());
}

function shortLived(name) {
  return VERCEL_SHORT_LIVED.test(name);
}

const TEMPLATE = /^\.env\.(example|sample|template|dist|defaults)$/;

// What a file feeds: its environment, whether it brings names only, and whether it's ticked by default.
// .env holds shared defaults, often committed, so it's offered unticked. Test files aren't secrets to keep.
function envFileKind(file) {
  const base = path.basename(file);
  if (TEMPLATE.test(base)) return { environment: "development", namesOnly: true, ticked: true };
  if (base === ".env") return { environment: "development", namesOnly: false, ticked: false };
  const m = /^\.env\.(local|development|development\.local|preview|preview\.local|production|production\.local)$/.exec(base);
  if (!m) return null;
  const environment = m[1] === "local" ? "development" : m[1].split(".")[0];
  return { environment, namesOnly: false, ticked: true };
}

// The .env files at the folder's root and, for monorepos, in apps/* and packages/*. Relative paths.
function findEnvFiles(folder) {
  const dirs = [""];
  for (const parent of ["apps", "packages"]) {
    for (const child of listDir(path.join(folder, parent))) {
      if (child.isDirectory()) dirs.push(path.join(parent, child.name));
    }
  }
  const files = [];
  for (const dir of dirs) {
    for (const entry of listDir(path.join(folder, dir))) {
      if (entry.isFile() && envFileKind(entry.name)) files.push(path.join(dir, entry.name));
    }
  }
  return files.sort();
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

module.exports = { parseEnv, isVercelPull, shortLived, envFileKind, findEnvFiles };
