import fs from "node:fs";
import path from "node:path";
import { resolveFolder } from "@/lib/folders";
import { asText } from "@/lib/format";
import { fail, guard } from "@/lib/guard";
import { listProjects, touchProject } from "@/lib/settings";

// One folder name, no separators, and it can't start with a dot (so no "..").
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Creates <parent>/<name> (or reuses it if that folder already exists) and adds it to the recent projects.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const name = asText(body.name).trim();
    if (!NAME.test(name)) throw new Error("Use letters, numbers, dots, dashes, and underscores for the name.");
    // resolveFolder treats an empty path as the home folder, which is never what's meant here.
    if (!asText(body.parent).trim()) throw new Error("Choose a parent folder.");
    const parent = resolveFolder(body.parent);

    const folder = path.join(parent, name);
    if (fs.existsSync(folder)) {
      if (!fs.statSync(folder).isDirectory()) throw new Error(`${folder} already exists and isn't a folder.`);
    } else {
      try {
        fs.mkdirSync(folder);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        throw new Error(`Couldn't create ${folder}${code ? ` (${code})` : ""}.`);
      }
    }

    touchProject(folder);
    return Response.json({ path: folder, projects: listProjects() });
  } catch (err) {
    return fail(err);
  }
}
