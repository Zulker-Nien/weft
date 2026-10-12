import path from "node:path";
import { repoCards } from "./commit-pile";
import { clip, timeAgo } from "./format";
import { SHOW_DIR } from "./show-dir";
import type { Card } from "./types";

// The Backlog sprint plan: cards pile up in Backlog faster than anyone starts them. The header counter
// (components/BacklogBadge.tsx) shows how many wait in the project in view; clicking it starts a card with
// sprintPrompt, which reads every Backlog card against the code and plans them into sprints of cards
// that can run side by side in one folder (no worktrees, see SOUL.md), then starts a sprint on your OK.

export interface BacklogMap {
  // Backlog cards in this repo, oldest first.
  backlog: Card[];
  // Cards at work in this repo (Running, Needs you, Review): a sprint should stay clear of their files.
  active: Card[];
}

// The repo's open cards split into Backlog and the rest; root is a repo top (or a plain folder).
export function mapBacklog(cards: Card[], root: string): BacklogMap {
  const open = repoCards(cards, root);
  return {
    backlog: open.filter((c) => c.column === "backlog").sort((a, b) => a.createdAt - b.createdAt),
    active: open.filter((c) => c.column !== "backlog"),
  };
}

// A card's prompt on one line, clipped: enough for the planner to know what it asks without the whole brief.
function promptLine(prompt: string, max = 700) {
  return clip(prompt.replace(/\s+/g, " ").trim(), max);
}

// The files a card at work has touched, repo-relative, the first few only.
function touchedLine(card: Card, root: string, show = 8) {
  const rel = (card.touchedFiles ?? []).map((p) => path.relative(root, p)).filter((p) => p && !p.startsWith(".."));
  if (!rel.length) return "no files touched yet";
  return rel.slice(0, show).join(", ") + (rel.length > show ? `, +${rel.length - show} more` : "");
}

export interface SprintPromptInput {
  root: string;
  map: BacklogMap;
  // The board's own server, so the thread can start, add and archive cards when the user says so.
  origin: string;
  now: number;
}

// The first message of the sprint planning card.
export function sprintPrompt({ root, map, origin, now }: SprintPromptInput) {
  const name = path.basename(root);
  const out: string[] = [
    `Plan the Backlog of ${root} into sprints: ${map.backlog.length} card${map.backlog.length === 1 ? "" : "s"} wait there. Read each one against the code, then tell me how we'll get through all of them.`,
    "",
    "Rules: this is planning. Don't edit any file in the project, and don't start, add, change or archive a card until I say so. Every card here runs in the same folder (no worktrees), so two cards that edit the same files must not run at the same time.",
    "",
    "Backlog cards, oldest first:",
  ];
  map.backlog.forEach((card, i) => {
    out.push(`${i + 1}. "${card.title}" (card ${card.id}, added ${timeAgo(card.createdAt, now)}${card.tags?.length ? `, tagged ${card.tags.join(", ")}` : ""})`);
    out.push(`   asks: ${promptLine(card.prompt) || "(no prompt)"}`);
  });
  if (map.active.length) {
    out.push("", "Already at work in this repo (plan around their files, and don't start a card that would collide with one):");
    for (const card of map.active) {
      const status = [card.stage && `stage ${card.stage}`, card.remaining && `remaining: ${card.remaining}`].filter(Boolean).join("; ");
      out.push(`- "${card.title}" (card ${card.id}, ${card.column}${status ? `; ${status}` : ""}): ${touchedLine(card, root)}`);
    }
  }

  const api = `${origin}/api/cards`;
  out.push(
    "",
    "How to go:",
    "1. For each Backlog card, find the code it would change (search, read; no edits) and work out: which files and areas it touches; its size (S under an hour of agent work, M a few turns, L a day or more); what it depends on; and whether it's already done (check `git log` and the code), a duplicate of another card, too vague to start, or too big for one card.",
    "2. Group the cards into sprints. A sprint is a set of cards that can run side by side: no two touch the same files, and none collides with a card already at work. Keep a sprint to 3 or 4 cards so you can review them in one sitting. Order the sprints by dependency first, then by value to the user, quick wins early. Ready-to-start cards go in Sprint 1; cards needing a decision wait in \"Needs a decision\".",
    `3. Write the plan as a page at ${SHOW_DIR}/sprint-${name}/index.html, for someone who doesn't read code. Open it with mcp__browser__open_url and rewrite it after every change, so the pane always shows the current plan.`,
    "   - At the top: one plain sentence on the whole plan (\"3 sprints, about 2 days, starting with the quick fixes\") and what happens next.",
    "   - One column per sprint, left to right. Each card in it: its title as a headline, ONE plain sentence (under 25 words) on what it changes for the person using the app, a size badge (S/M/L), and a small \"after: <card>\" note when it depends on another. No card ids, no file names on the face.",
    "   - Tuck the engineering detail into a closed <details> \"Technical details\" per card: the files and areas it touches, why it sits in this sprint, what it collides with.",
    "   - A \"Needs a decision\" section for duplicates, already-done, vague and too-big cards: each with its question in plain words and answer buttons.",
    "   - Buttons are links to `weft://reply?text=<url-encoded message>`: Weft sends that text to this thread as my reply (it only works from a local page in this card's own pane). Name the card or sprint in every message, like `Start sprint 1.` or `Merge \"Dark mode\" into \"Theme settings\".` Per sprint: \"Start this sprint\". Per card: \"Move to sprint…\" (one link per other sprint), and where it applies \"Merge\", \"Split\", \"Archive (already done)\". Add a one-line text box with Send for \"Tell me what to change\" (on submit, set location.href to the weft://reply link with the typed words). After a click, grey out that control and show \"Sent, working on it…\" until you rewrite the page.",
    "4. Wait for my answers. Change the plan when I ask and rewrite the page.",
    "5. When I say start a sprint, start each of its cards with",
    `   curl -s -X PATCH ${api}/<card id> -H 'x-threadboard: 1' -H 'content-type: application/json' -d '{"column":"running"}'`,
    "   then mark that sprint Started on the page. Don't start the next sprint until I ask: its cards may need this one's work committed first (the +N/-N counter beside Backlog walks through that).",
    "6. On my OK only: merge or split cards by adding the new ones to Backlog with",
    `   curl -s -X POST ${api} -H 'x-threadboard: 1' -H 'content-type: application/json' -d '{"title":"…","prompt":"<a self-contained brief>","cwd":"${root}"}'`,
    "   and archive the cards they replace (or ones already done) with",
    `   curl -s -X PATCH ${api}/<card id> -H 'x-threadboard: 1' -H 'content-type: application/json' -d '{"archived":true}'`,
  );
  return out.join("\n");
}
