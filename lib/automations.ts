import { automations } from "./settings";
import type { AutomationTrigger, Card, Column } from "./types";

// Board automations: Settings rules like "when you move a card to Done, run weft:done". A rule's
// skill runs in the card's own thread, as if you'd typed /<skill> there, so it sees the whole
// conversation. lib/runner.ts runs the messages (queueMessages); this file decides what they are.

function skillsFor(trigger: AutomationTrigger) {
  return [...new Set(automations().filter((rule) => rule.on === trigger).map((rule) => rule.skill))];
}

// A rule's pattern as a case-insensitive regex; one that's empty or doesn't compile never matches.
export function patternRegex(source: string | undefined): RegExp | null {
  if (!source?.trim()) return null;
  try {
    return new RegExp(source, "i");
  } catch {
    return null;
  }
}

// A thread's first message: its prompt, plus the skills the "a thread starts" rules name. They go in
// as an instruction instead of /<skill> turns of their own, so each skill sees the task it's for and
// the prompt runs once.
export function firstMessage(card: Card): string {
  const skills = skillsFor("start").map((skill) => `/${skill}`);
  if (!skills.length) return card.prompt;
  const line =
    skills.length === 1 ? `Start by using the ${skills[0]} skill.` : `Start by using these skills, in order: ${skills.join(", ")}.`;
  return `${card.prompt}\n\n${line}`;
}

// The /<skill> messages to run, one turn each, after you move a card into a column. Only your own
// moves call this: a thread reporting itself done doesn't, or the done skill would run itself again.
export function messagesForMove(card: Card, column: Column): string[] {
  if (column !== "review" && column !== "done") return [];
  // A card that never ran has no conversation to wrap up.
  if (!card.sessionId) return [];
  // A session picked up from Claude Code that Weft hasn't run belongs to the app that started it.
  if (card.source === "claude-code" && !card.lastWeftTurn) return [];
  return skillsFor(column).map((skill) => `/${skill}`);
}

// The skills a "prompt matches" rule wants for a prompt you send, minus the ones this thread has
// already run: each fires once per thread, like a hook that injects its context on the first keyword.
export function skillsForPrompt(card: Card, prompt: string): string[] {
  const ran = new Set(card.promptSkills);
  const matched = automations()
    .filter((rule) => rule.on === "prompt-matches" && patternRegex(rule.pattern)?.test(prompt))
    .map((rule) => rule.skill);
  return [...new Set(matched)].filter((skill) => !ran.has(skill));
}
