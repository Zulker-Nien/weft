import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { asText } from "./format";

// Turns "~/dev/app" or a relative path into an absolute folder that exists, or throws.
// An empty or missing value throws, so a POST that forgot the field fails the same way one that named a missing
// path does — and the route's 400 doesn't depend on the user's home directory existing.
export function resolveFolder(raw: unknown): string {
  const text = asText(raw).trim();
  if (!text) throw new Error("A folder is required.");
  const folder = path.resolve(text.replace(/^~(?=$|\/)/, os.homedir()));
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error(`${folder} isn't a folder.`);
  return folder;
}
