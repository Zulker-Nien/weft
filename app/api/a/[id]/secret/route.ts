// /api/a/<id>/secret — a viewer's own secret value, the `from: "viewer"` half of cloud_app_secrets.
// Three ops: GET (does the viewer have a value?), PUT (set it), DELETE (clear it). The viewer's id is from
// the same web session the route uses everywhere else. A name that's not in the manifest, or that's not
// declared `from: "viewer"`, is a 400 — the page called the wrong secret. The PUT body caps at 4 KB (a
// real-world key is well under that). All three log the call; we never log the value.
import { connection } from "next/server";
import { appShareAccess } from "@/lib/app-share-access";
import { clientIpFromHeaders, fetchLimitVerdict, insertFetchLog } from "@/lib/app-fetch-limit";
import { NO_STORE, rateLimited, reject } from "@/lib/app-share-reply";
import { isConfigured as secretsConfigured } from "@/lib/app-secrets";
import { createAppSecretStore } from "@/lib/app-secret-store";
import { serviceClient, webUser } from "@/lib/web-session";

const MAX_PUT_BYTES = 4 * 1024;
const NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

type ServiceClient = NonNullable<ReturnType<typeof serviceClient>>;

// The manifest's declaration of a name: true when the name is a viewer secret. Anything else (author,
// unknown) is a 400. We don't surface the rule's details through this route — the policy module enforces
// what hosts a value may reach on the /fetch side.
function isViewerSecret(manifest: unknown, name: string): boolean {
  if (!manifest || typeof manifest !== "object") return false;
  const secrets = (manifest as { secrets?: unknown }).secrets;
  if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) return false;
  const rule = (secrets as Record<string, unknown>)[name];
  return !!rule && typeof rule === "object" && (rule as Record<string, unknown>).from === "viewer";
}

// The gate, the service client and the viewer: three early-returns common to GET / PUT / DELETE. The caller
// passes them to the rate limit + secret-store helpers below.
async function loadRequest(req: Request, id: string, name: string): Promise<
  { service: ServiceClient; viewer: NonNullable<Awaited<ReturnType<typeof webUser>>> } | Response
> {
  if (!NAME_RE.test(name)) return reject(400, "name isn't a valid secret name.");
  const access = await appShareAccess(id);
  if (access.kind === "missing") return reject(404, "this app link no longer exists.");
  if (access.kind !== "ok") return reject(403, "you don't have access to this app link.");
  if (!isViewerSecret(access.share.manifest, name)) return reject(400, `${name} isn't a viewer-provided secret.`);
  const service = serviceClient();
  if (!service) return reject(503, "this server isn't configured to run apps.");
  const viewer = await webUser();
  if (!viewer) return reject(401, "sign in to manage your value for this app.");
  return { service, viewer };
}

// The rate limit (429 with Retry-After) and the secret-store call's set up. The caller does the actual work
// between this and the log row so the route file stays a thin shim. The method is "SECRET" for the log and
// the path is "/<name>" so the viewer-side log shows the secret's name, never its value.
async function runSecretOp(
  req: Request,
  service: ServiceClient,
  id: string,
  viewer: NonNullable<Awaited<ReturnType<typeof webUser>>>,
  name: string,
  work: (store: ReturnType<typeof createAppSecretStore>) => Promise<unknown>,
): Promise<Response> {
  const clientIp = clientIpFromHeaders(req.headers);
  const verdict = await fetchLimitVerdict(service, id, viewer.id, clientIp);
  if (!verdict.ok) {
    await insertFetchLog(service, { shareId: id, viewerId: viewer.id, method: "SECRET", host: "", path: `/${name}`, status: 429 });
    return rateLimited(verdict.retryAfter);
  }
  if (!secretsConfigured()) return reject(503, "App secrets aren't set up on this server.");
  try {
    const result = await work(createAppSecretStore(service));
    await insertFetchLog(service, { shareId: id, viewerId: viewer.id, method: "SECRET", host: "", path: `/${name}`, status: 200 });
    return Response.json(result, { headers: NO_STORE });
  } catch (err) {
    await insertFetchLog(service, { shareId: id, viewerId: viewer.id, method: "SECRET", host: "", path: `/${name}`, status: 500 });
    return reject(500, err instanceof Error ? err.message : String(err));
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  await connection();
  const { id } = await ctx.params;
  const name = new URL(req.url).searchParams.get("name") ?? "";
  const loaded = await loadRequest(req, id, name);
  if (loaded instanceof Response) return loaded;
  return runSecretOp(req, loaded.service, id, loaded.viewer, name, async (store) => ({ set: await store.hasValue(id, name, loaded.viewer.id) }));
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  await connection();
  const { id } = await ctx.params;
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_PUT_BYTES) return reject(413, "request body is too large.");
  let body: unknown;
  try { body = await req.json(); } catch { return reject(400, "request body must be JSON."); }
  if (!body || typeof body !== "object") return reject(400, "request shape isn't valid.");
  const m = body as Record<string, unknown>;
  const name = typeof m.name === "string" ? m.name : "";
  const value = typeof m.value === "string" ? m.value : "";
  if (!value) return reject(400, "value is missing.");
  const loaded = await loadRequest(req, id, name);
  if (loaded instanceof Response) return loaded;
  return runSecretOp(req, loaded.service, id, loaded.viewer, name, async (store) => {
    await store.setValue(id, name, loaded.viewer.id, value);
    return { set: true };
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  await connection();
  const { id } = await ctx.params;
  const name = new URL(req.url).searchParams.get("name") ?? "";
  const loaded = await loadRequest(req, id, name);
  if (loaded instanceof Response) return loaded;
  return runSecretOp(req, loaded.service, id, loaded.viewer, name, async (store) => {
    await store.removeValue(id, name, loaded.viewer.id);
    return { set: false };
  });
}