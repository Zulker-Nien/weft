import fs from "node:fs";
import path from "node:path";
import { ASSETS } from "@/lib/show";
import { guard } from "@/lib/guard";
import { sceneOf } from "@/lib/theme";

// A scene theme's picture (lib/theme.ts), from the same assets the starter page uses. Only the
// listed scenes are served, so the id can't name any other file.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  const scene = sceneOf((await params).id);
  if (!scene) return Response.json({ error: "No such scene." }, { status: 404 });
  try {
    const bytes = await fs.promises.readFile(path.join(ASSETS, scene.image));
    return new Response(bytes, {
      headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=86400" },
    });
  } catch {
    return Response.json({ error: "Scene picture missing." }, { status: 404 });
  }
}
