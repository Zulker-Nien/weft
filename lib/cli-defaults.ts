import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PUKU_SETTINGS } from "./puku-trial";
import type { Backend, CardStats, Effort } from "./types";

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

function settingsFile(backend: Backend) {
  if (backend === "puku") return PUKU_SETTINGS;
  if (backend === "codex") return path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "config.toml");
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "settings.json");
}

// The effort a CLI runs at when the card picks none: its user settings, if set.
export function defaultEffort(backend: Backend): Effort | undefined {
  try {
    if (backend === "codex") {
      const content = fs.readFileSync(settingsFile(backend), "utf8");
      const level = /^\s*model_reasoning_effort\s*=\s*["']([^"']+)["']/m.exec(content)?.[1];
      return EFFORTS.find((e) => e === level);
    }
    const level = (JSON.parse(fs.readFileSync(settingsFile(backend), "utf8")) as { effortLevel?: unknown } | null)?.effortLevel;
    return EFFORTS.find((e) => e === level);
  } catch {
    return undefined;
  }
}

// What a thread's CLI really runs on: the model its init named (the card's pick, or the CLI's default
// resolved to an id) and the card's effort, or the CLI's default one.
export function runsOn(model: string | undefined, card: { backend: Backend; effort?: Effort }): CardStats["runsOn"] {
  if (!model) return undefined;
  return { model, effort: card.effort ?? defaultEffort(card.backend) };
}
