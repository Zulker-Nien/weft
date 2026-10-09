import { randomUUID } from "node:crypto";
import { connection } from "next/server";
import { patternRegex } from "@/lib/automations";
import { fail, guard } from "@/lib/guard";
import { setAutomations, setKeepAliveMinutes, setThreadPrompt, settingsView } from "@/lib/settings";
import { SKILL_NAME } from "@/lib/skills";
import { AUTOMATION_TRIGGERS, type Automation } from "@/lib/types";

// The rules as sent, checked; a leading slash on a skill name is dropped.
function readAutomations(value: unknown): Automation[] {
  if (!Array.isArray(value)) throw new Error("automations must be a list.");
  return value.map((raw) => {
    const rule = (raw ?? {}) as Record<string, unknown>;
    const trigger = AUTOMATION_TRIGGERS.find((t) => t.id === rule.on);
    if (!trigger) throw new Error(`Unknown automation trigger ${JSON.stringify(rule.on)}.`);
    const skill = String(rule.skill ?? "").trim().replace(/^\//, "");
    if (!SKILL_NAME.test(skill)) throw new Error(`Pick a skill for “when ${trigger.label}”.`);
    const id = typeof rule.id === "string" && rule.id ? rule.id : randomUUID();
    if (trigger.id !== "prompt-matches") return { id, on: trigger.id, skill };
    const pattern = String(rule.pattern ?? "").trim();
    if (!pattern) throw new Error(`Enter a pattern for “when ${trigger.label}”.`);
    if (!patternRegex(pattern)) throw new Error(`“${pattern}” isn't a valid pattern.`);
    return { id, on: trigger.id, skill, pattern };
  });
}

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  return Response.json(settingsView());
}

export async function PATCH(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { threadPrompt?: unknown; keepAliveMinutes?: unknown; automations?: unknown };

    if (body.threadPrompt !== undefined && typeof body.threadPrompt !== "string") {
      throw new Error("threadPrompt must be text.");
    }
    if (
      body.keepAliveMinutes !== undefined &&
      (typeof body.keepAliveMinutes !== "number" || !Number.isFinite(body.keepAliveMinutes) || body.keepAliveMinutes < 0)
    ) {
      throw new Error("keepAliveMinutes must be a number of minutes, 0 or more.");
    }
    const rules = body.automations === undefined ? undefined : readAutomations(body.automations);

    if (typeof body.threadPrompt === "string") setThreadPrompt(body.threadPrompt);
    if (typeof body.keepAliveMinutes === "number") setKeepAliveMinutes(body.keepAliveMinutes);
    if (rules) setAutomations(rules);
    return Response.json(settingsView());
  } catch (err) {
    return fail(err);
  }
}
