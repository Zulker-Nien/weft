import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { isSkillName, setCardSkill, setProjectSkill, skillSetView } from "@/lib/skill-set-actions";
import { getCard } from "@/lib/store";

// A project's skill set (?cwd=) or a card's (?card=): every skill and plugin, and whether it's on (lib/skill-sets.ts).
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    const params = new URL(req.url).searchParams;
    const cardId = params.get("card");
    const card = cardId ? getCard(cardId) : undefined;
    const cwd = card?.cwd ?? params.get("cwd");
    if (!cwd) return Response.json({ error: "Pass ?cwd= or a card that exists." }, { status: 400 });
    return Response.json(skillSetView(cwd, card));
  } catch (err) {
    return fail(err);
  }
}

// { cwd, name, on } changes the project's default set; { card, name, on } just that card's.
export async function PUT(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { cwd?: unknown; card?: unknown; name?: unknown; on?: unknown };
    if (!isSkillName(body.name) || typeof body.on !== "boolean") throw new Error("name and on are required.");
    if (typeof body.card === "string") {
      const card = await setCardSkill(body.card, body.name, body.on);
      if (!card) return Response.json({ error: "No such card." }, { status: 404 });
      return Response.json(skillSetView(card.cwd, card));
    }
    if (typeof body.cwd !== "string" || !body.cwd) throw new Error("cwd or card is required.");
    setProjectSkill(body.cwd, body.name, body.on);
    return Response.json(skillSetView(body.cwd));
  } catch (err) {
    return fail(err);
  }
}
