import { fail, guard } from "@/lib/guard";

// POST /api/apps/build { slug }: rebuilds the app folder and replies with its .weft-build.json. A rebuild
// triggered from a card, the rail's right-click menu, or the API itself; the watcher (lib/app-build-watch.ts)
// does the same on every save. Guarded like the other app write routes: localhost-only and the x-weft-token.
// lib/app-build.ts and esbuild load only on the POST path, never on every route's import path.

type Body = { slug?: unknown };

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Body;
    const slug = typeof body.slug === "string" ? body.slug.trim() : "";
    if (!slug) return fail("slug is required.");
    // Validate the slug here too, so a bad body fails fast before we lazy-import esbuild. The lib
    // re-validates on its own; the route-level check is the one we surface as a 400.
    const { isAppFolderSlug } = await import("@/lib/app-build");
    if (!isAppFolderSlug(slug)) return fail(`Invalid app folder name "${slug}".`);
    // Lazy: esbuild lives behind this import, so a tree-shaken route file that never answers POST
    // never pays the cost of bundling it.
    const { buildApp, readBuildInfo } = await import("@/lib/app-build");
    const result = await buildApp(slug);
    const info = readBuildInfo(slug) ?? {
      ok: result.ok === true ? true : result.ok === false ? false : "skipped",
      at: result.at,
      inputsHash: result.inputsHash,
      ...(result.ok === false ? { error: result.error } : {}),
    };
    return Response.json({ result, info });
  } catch (err) {
    return fail(err);
  }
}
