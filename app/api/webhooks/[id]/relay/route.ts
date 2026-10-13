import { fail, guard } from "@/lib/guard";
import { createRelay, removeRelay } from "@/lib/webhook-forward";

type Ctx = { params: Promise<{ id: string }> };

// A webhook's public relay URL on the deployed Weft (lib/webhook-forward.ts): POST makes it, DELETE takes it down.

export async function POST(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    return Response.json({ hook: await createRelay((await params).id) });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    return Response.json({ hook: await removeRelay((await params).id) });
  } catch (err) {
    return fail(err);
  }
}
