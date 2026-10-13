import { randomUUID } from "node:crypto";
import { connection } from "next/server";
import { patternRegex } from "@/lib/automations";
import { asText } from "@/lib/format";
import { fail, guard } from "@/lib/guard";
import { setAutomations, setDefaultBackend, setDefaultPermissionMode, setKeepAliveMinutes, setPushOnDone, setSubagentModel, setThreadPrompt, settingsView } from "@/lib/settings";
import { SKILL_NAME } from "@/lib/skills";
import { isSubagentModel } from "@/lib/subagents";
import { AUTOMATION_TRIGGERS, MODES, type Automation, type Backend, type PermissionMode } from "@/lib/types";

const BACKENDS: Backend[] = ["claude", "puku"];

// The rules as sent, checked; a leading slash on a skill name is dropped.
function readAutomations(value: unknown): Automation[] {
  if (!Array.isArray(value)) throw new Error("automations must be a list.");
  return value.map((raw) => {
    const rule = (raw ?? {}) as Record<string, unknown>;
    const trigger = AUTOMATION_TRIGGERS.find((t) => t.id === rule.on);
    if (!trigger) throw new Error(`Unknown automation trigger ${JSON.stringify(rule.on)}.`);
    const skill = asText(rule.skill).trim().replace(/^\//, "");
    if (!SKILL_NAME.test(skill)) throw new Error(`Pick a skill for “when ${trigger.label}”.`);
    const id = typeof rule.id === "string" && rule.id ? rule.id : randomUUID();
    if (trigger.id !== "prompt-matches") return { id, on: trigger.id, skill };
    const pattern = asText(rule.pattern).trim();
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

function validate(body: {
  threadPrompt?: unknown;
  keepAliveMinutes?: unknown;
  defaultPermissionMode?: unknown;
  defaultBackend?: unknown;
  automations?: unknown;
  pushOnDone?: unknown;
  subagentModel?: unknown;
}): Automation[] | undefined {
  if (body.threadPrompt !== undefined && typeof body.threadPrompt !== "string") {
    throw new Error("threadPrompt must be text.");
  }
  if (
    body.keepAliveMinutes !== undefined &&
    (typeof body.keepAliveMinutes !== "number" || !Number.isFinite(body.keepAliveMinutes) || body.keepAliveMinutes < 0)
  ) {
    throw new Error("keepAliveMinutes must be a number of minutes, 0 or more.");
  }
  if (body.defaultPermissionMode !== undefined && !MODES.includes(body.defaultPermissionMode as PermissionMode)) {
    throw new Error(`defaultPermissionMode must be one of ${MODES.join(", ")}.`);
  }
  if (body.defaultBackend !== undefined && !BACKENDS.includes(body.defaultBackend as Backend)) {
    throw new Error(`defaultBackend must be one of ${BACKENDS.join(", ")}.`);
  }
  if (body.pushOnDone !== undefined && typeof body.pushOnDone !== "boolean") throw new Error("pushOnDone must be true or false.");
  if (body.subagentModel !== undefined && !isSubagentModel(body.subagentModel)) {
    throw new Error("subagentModel must be choose, inherit, or a model id one of the CLIs serves.");
  }
  // Validate automations now so a bad rule 400s before any settings setter runs.
  return body.automations === undefined ? undefined : readAutomations(body.automations);
}

function commit(body: {
  threadPrompt?: unknown;
  keepAliveMinutes?: unknown;
  defaultPermissionMode?: unknown;
  defaultBackend?: unknown;
  pushOnDone?: unknown;
  subagentModel?: unknown;
}, rules: Automation[] | undefined) {
  if (typeof body.threadPrompt === "string") setThreadPrompt(body.threadPrompt);
  if (typeof body.keepAliveMinutes === "number") setKeepAliveMinutes(body.keepAliveMinutes);
  if (body.defaultPermissionMode !== undefined) setDefaultPermissionMode(body.defaultPermissionMode as PermissionMode);
  if (body.defaultBackend !== undefined) setDefaultBackend(body.defaultBackend as Backend);
  if (typeof body.pushOnDone === "boolean") setPushOnDone(body.pushOnDone);
  if (isSubagentModel(body.subagentModel)) setSubagentModel(body.subagentModel);
  if (rules) setAutomations(rules);
}

export async function PATCH(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Parameters<typeof validate>[0];
    const rules = validate(body);
    commit(body, rules);
    return Response.json(settingsView());
  } catch (err) {
    return fail(err);
  }
}
