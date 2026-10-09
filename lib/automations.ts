import { automations } from "./settings";
import type { AutomationTrigger, Card, Column } from "./types";

// Board automations: Settings rules like "when you move a card to Done, run weft:done". A rule's
// skill runs in the card's own thread, as if you'd typed /<skill> there, so it sees the whole
// conversation. lib/runner.ts runs the messages (queueMessages); this file decides what they are.

function skillsFor(trigger: AutomationTrigger) {
  return [...new Set(automations().filter((rule) => rule.on === trigger).map((rule) => rule.skill))];
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
