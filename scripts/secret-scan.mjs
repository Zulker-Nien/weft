// The pre-commit hook's secret scan when gitleaks isn't installed (scripts/check-staged.sh): each line the
// commit adds, through the key shapes the Composer's paste guard uses (lib/secret-detect.ts). Narrower
// than gitleaks, so the hook still suggests installing it. Test files are skipped (their keys are
// fixtures), as is a line marked `gitleaks:allow`. Exits 1 listing what it found, values masked.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { findSecret } from "../lib/secret-detect.ts";

const SKIP_FILE = /\.test\.[cm]?[jt]sx?$|(^|\/)__fixtures__\//;

// What a unified diff (git diff -U0) adds that looks like a secret: [{ file, line, kind, preview }].
export function scanDiff(diff) {
  const hits = [];
  let file = null;
  let line = 0;
  for (const text of diff.split("\n")) {
    if (text.startsWith("+++ ")) {
      file = text === "+++ /dev/null" ? null : text.replace(/^\+\+\+ (b\/)?/, "");
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(text);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (!text.startsWith("+") || !file) continue;
    const added = text.slice(1);
    const at = line++;
    if (SKIP_FILE.test(file) || added.includes("gitleaks:allow")) continue;
    const match = findSecret(added);
    // The masked preview only: a scan report shouldn't carry the key itself.
    if (match) hits.push({ file, line: at, kind: match.kind, preview: match.preview });
  }
  return hits;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const diff = execFileSync("git", ["diff", "--cached", "-U0", "--no-color", "--no-ext-diff"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const hits = scanDiff(diff);
  for (const h of hits.slice(0, 30)) console.error(`  ${h.file}:${h.line}  ${h.kind}  ${h.preview}`);
  process.exit(hits.length ? 1 : 0);
}
