import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store";
import { cleanCardIds, cleanSprintName, defaultSprintName, type Sprint } from "./sprints";

// The saved sprints (lib/sprints.ts), in ~/.weft/sprints.json.

// Read when used, not at import, so routes that only pass through here load without the store.
const sprintsFile = () => path.join(DATA_DIR, "sprints.json");

export function listSprints(): Sprint[] {
  try {
    const sprints = (JSON.parse(fs.readFileSync(sprintsFile(), "utf8")) as { sprints?: Sprint[] }).sprints;
    return Array.isArray(sprints) ? sprints : [];
  } catch {
    return [];
  }
}

function writeSprints(sprints: Sprint[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(sprintsFile(), JSON.stringify({ sprints }, null, 2));
}

function find(sprints: readonly Sprint[], id: unknown): Sprint {
  const sprint = sprints.find((s) => s.id === id);
  if (!sprint) throw new Error("No such sprint.");
  return sprint;
}

// The cards as a new sprint, named "Sprint N · <day>" unless a name comes with them.
export function saveSprint(rawIds: unknown, rawName?: unknown, now = Date.now()): Sprint {
  const cardIds = cleanCardIds(rawIds);
  if (!cardIds.length) throw new Error("A sprint needs at least one card.");
  const sprints = listSprints();
  const sprint: Sprint = { id: crypto.randomUUID(), name: cleanSprintName(rawName) ?? defaultSprintName(sprints, now), cardIds, createdAt: now };
  writeSprints([...sprints, sprint]);
  return sprint;
}

export function renameSprint(id: unknown, rawName: unknown): Sprint {
  const sprints = listSprints();
  const sprint = find(sprints, id);
  const name = cleanSprintName(rawName);
  if (!name) throw new Error("A sprint needs a name.");
  const renamed = { ...sprint, name };
  writeSprints(sprints.map((s) => (s.id === sprint.id ? renamed : s)));
  return renamed;
}

export function removeSprint(id: unknown) {
  const sprints = listSprints();
  find(sprints, id);
  writeSprints(sprints.filter((s) => s.id !== id));
}
