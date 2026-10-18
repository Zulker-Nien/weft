#!/usr/bin/env node
// scout-save.mjs — merge the scout agent's findings into the report Weft's quality badge reads.
// Usage: scout-save.mjs <findings.json> <session file> ...
//
// The report is <WEFT_DATA or ~/.weft>/scout/<sha1(repo root)[:16]>.json (lib/scout.ts reads
// the same file). The session files were re-scouted, so their old findings are replaced; findings
// elsewhere stay open until a later session touches their file.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CATEGORIES = ["refactor", "lint", "types", "tests", "guardrails"];
const SEVERITIES = ["high", "medium", "low"];
const MAX_FINDINGS = 15;

const [findingsFile, ...session] = process.argv.slice(2);
if (!findingsFile) {
  console.error("Usage: scout-save.mjs <findings.json> <session file> ...");
  process.exit(1);
}

const git = (...args) => {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};
const root = git("rev-parse", "--show-toplevel") ?? process.cwd();
const rel = (f) => path.relative(root, path.resolve(f));
const clean = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function toFinding(r) {
  if (!r || typeof r !== "object") return null;
  const file = clean(r.file, 300).replace(/^\.\//, "");
  const smell = clean(r.smell, 60);
  const fix = clean(r.fix, 300);
  if (!file || !smell || !fix || !CATEGORIES.includes(r.category)) return null;
  const line = typeof r.line === "number" && r.line > 0 ? Math.floor(r.line) : 1;
  const severity = SEVERITIES.includes(r.severity) ? r.severity : "medium";
  return { id: `${file}:${line}:${smell}`, file, line, smell, category: r.category, severity, fix };
}

let raw;
try {
  raw = JSON.parse(fs.readFileSync(findingsFile, "utf8"));
} catch (err) {
  console.error(`scout-save: can't read ${findingsFile}: ${err.message}`);
  process.exit(1);
}
const fresh = (Array.isArray(raw) ? raw : []).map(toFinding).filter(Boolean);

const dir = path.join(process.env.WEFT_DATA || path.join(os.homedir(), ".weft"), "scout");
const file = path.join(dir, `${createHash("sha1").update(root).digest("hex").slice(0, 16)}.json`);
let old = null;
try {
  old = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {
  // First run for this repo.
}

const rescouted = new Set(session.map(rel));
const kept = (old?.findings ?? []).filter((f) => !rescouted.has(f.file));
const rank = (f) => SEVERITIES.indexOf(f.severity);
const findings = [...fresh, ...kept.filter((k) => !fresh.some((f) => f.id === k.id))]
  .sort((a, b) => rank(a) - rank(b))
  .slice(0, MAX_FINDINGS);
const ids = new Set(findings.map((f) => f.id));

const report = {
  root,
  commit: git("rev-parse", "HEAD"),
  ranAt: Date.now(),
  findings,
  started: (old?.started ?? []).filter((id) => ids.has(id)),
};
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(file, JSON.stringify(report, null, 2));
console.log(`scout-save: ${fresh.length} new, ${findings.length} open → ${file}`);
