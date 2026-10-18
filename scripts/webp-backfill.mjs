// Converts the PNG, JPEG and GIF attachments saved before Weft wrote WebP (lib/attachments.ts) and points
// Weft's own records at the WebP copies.
//
//   node scripts/webp-backfill.mjs            what it would do; changes nothing
//   node scripts/webp-backfill.mjs --convert  make a .webp beside each original (safe while Weft runs)
//   node scripts/webp-backfill.mjs --rewrite  with Weft quit: point board.json and threads/ at the .webp files,
//                                             then delete each original nothing else mentions
//
// Originals that ~/.claude/projects transcripts, pages, show/ or the sync outbox still mention stay, so a
// resumed session or an old page keeps working. The server keeps the board and threads in memory and writes them
// back, so --rewrite refuses while Weft runs.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const DATA = process.env.THREADBOARD_DATA ?? path.join(os.homedir(), ".weft");
const DIR = path.join(DATA, "attachments");
const RASTER = /^(.+)\.(png|jpe?g|gif)$/i;
const mode = process.argv.includes("--rewrite") ? "rewrite" : process.argv.includes("--convert") ? "convert" : "plan";

const webpOf = (name) => name.replace(RASTER, "$1.webp");
const originals = fs.readdirSync(DIR).filter((n) => RASTER.test(n) && !n.endsWith(".preview.jpg") && !n.includes(".tmp"));
const sizeOf = (file) => (fs.existsSync(file) ? fs.statSync(file).size : 0);
const mb = (bytes) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;

// Weft's Electron or its next dev server. ps, not pgrep: pgrep -f missed Weft's own Electron here.
function weftRunning() {
  const procs = execFileSync("ps", ["-A", "-o", "command="], { encoding: "utf8" });
  return /node_modules\/electron\/dist\/Electron\.app\/Contents\/MacOS\/Electron |next-server|next\/dist\/bin\/next dev/.test(procs);
}

// Every text file under a folder, for finding which attachment names it mentions.
function* textFiles(dir) {
  if (!fs.existsSync(dir)) return;
  if (fs.statSync(dir).isFile()) return yield dir;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* textFiles(full);
    else if (/\.(jsonl?|html?|md|txt)$/.test(entry.name)) yield full;
  }
}

// The attachment names the files under these paths mention; exit 1 from grep means none.
function mentioned(paths) {
  if (!paths.length) return [];
  try {
    const out = execFileSync("grep", ["-rhoIE", "[a-z0-9-]+-[0-9a-f]{8,12}\\.(png|jpe?g|gif)", ...paths], { encoding: "utf8", maxBuffer: 256 * 1024 ** 2 });
    return out.split("\n").filter(Boolean);
  } catch (err) {
    if (err.status === 1) return [];
    throw err;
  }
}

async function convert() {
  let done = 0;
  let failed = 0;
  for (const name of originals) {
    const target = path.join(DIR, webpOf(name));
    if (fs.existsSync(target)) continue;
    const temp = `${target}.backfill.tmp`;
    try {
      await sharp(path.join(DIR, name), { animated: true }).rotate().webp({ quality: 85, effort: 4 }).toFile(temp);
      fs.renameSync(temp, target);
      done++;
    } catch {
      fs.rmSync(temp, { force: true });
      failed++;
    }
  }
  console.log(`Converted ${done}; ${failed} couldn't be read and stay as they are.`);
}

function rewrite() {
  // Only the live folder is Weft's; a copy (THREADBOARD_DATA) can be rewritten any time.
  if (!process.env.THREADBOARD_DATA && weftRunning()) {
    console.error("Weft is running. Quit it first: it keeps the board and threads in memory and would write the old names back.");
    process.exit(1);
  }
  const renames = new Map(originals.filter((n) => fs.existsSync(path.join(DIR, webpOf(n)))).map((n) => [n, webpOf(n)]));
  // Attachment names look like "screenshot-1a2b3c4d5e6f.png"; only ones that were converted are touched.
  const pattern = /[a-z0-9-]+-[0-9a-f]{8,12}\.(?:png|jpe?g|gif)/gi;
  let edited = 0;
  for (const file of [path.join(DATA, "board.json"), ...textFiles(path.join(DATA, "threads"))]) {
    const text = fs.readFileSync(file, "utf8");
    const next = text.replace(pattern, (n) => renames.get(n) ?? n);
    if (next === text) continue;
    fs.writeFileSync(`${file}.backfill.tmp`, next);
    fs.renameSync(`${file}.backfill.tmp`, file);
    edited++;
  }
  // Names still mentioned outside Weft's own records keep their original.
  const kept = new Set();
  const sources = [path.join(os.homedir(), ".claude", "projects"), ...["pages", "show", "done-docs", "library", "sync-outbox.jsonl"].map((p) => path.join(DATA, p))];
  // grep, not a read of every file: ~/.claude/projects runs to gigabytes.
  for (const name of mentioned(sources.filter((p) => fs.existsSync(p)))) if (renames.has(name)) kept.add(name);
  let removed = 0;
  let freed = 0;
  for (const name of renames.keys()) {
    if (kept.has(name)) continue;
    const file = path.join(DIR, name);
    freed += sizeOf(file) + sizeOf(`${file}.preview.jpg`);
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.preview.jpg`, { force: true });
    removed++;
  }
  console.log(`Pointed ${edited} files at the WebP copies; deleted ${removed} originals (${mb(freed)}); kept ${kept.size} that sessions or pages still mention.`);
}

if (mode === "convert") await convert();
else if (mode === "rewrite") rewrite();
else {
  const pending = originals.filter((n) => !fs.existsSync(path.join(DIR, webpOf(n))));
  const bytes = originals.reduce((sum, n) => sum + sizeOf(path.join(DIR, n)), 0);
  console.log(`${originals.length} PNG/JPEG/GIF attachments (${mb(bytes)}), ${pending.length} without a WebP yet.`);
  console.log("Run with --convert now, then --rewrite with Weft quit.");
}
