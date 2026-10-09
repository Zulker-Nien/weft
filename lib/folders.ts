import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Turns "~/dev/app" or a relative path into an absolute folder that exists, or throws.
export function resolveFolder(raw: unknown): string {
  const text = String(raw ?? "").trim();
  const folder = path.resolve(text.replace(/^~(?=$|\/)/, os.homedir()) || os.homedir());
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error(`${folder} isn't a folder.`);
  return folder;
}
