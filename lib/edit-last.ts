import type { ThreadItem } from "./types";

// The tools that write files: their changes stay on disk when the turn that made them is edited away.
const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export interface LastSent {
  // Where it sits in the thread; the edit folds the thread from here on.
  index: number;
  text: string;
  // The id Weft sent it to the CLI with, which finds it in the session's transcript. Missing on
  // messages from before ↑ could edit, picked-up sessions and puku threads: those can't be rewound.
  promptId?: string;
  // File edits its turn made, which an edit leaves in place.
  fileEdits: number;
}

// The message ↑ in an empty reply box edits: your last one.
export function lastSent(items: readonly (ThreadItem | null | undefined)[]): LastSent | undefined {
  const index = items.findLastIndex((item) => item?.kind === "user");
  const item = items[index];
  if (item?.kind !== "user") return undefined;
  const fileEdits = items
    .slice(index + 1)
    .filter((i) => i?.kind === "tool" && FILE_TOOLS.has(i.name) && !i.isError).length;
  return { index, text: item.text, promptId: item.id, fileEdits };
}

// Where to resume a session so it drops the turn a prompt started: the transcript entry that prompt
// followed (the end of the turn before), null when the prompt opened the session, or undefined when
// the transcript doesn't hold it.
export function rewindPoint(transcript: string, promptId: string): string | null | undefined {
  for (const line of transcript.split("\n")) {
    if (!line.includes(promptId)) continue;
    try {
      const entry = JSON.parse(line) as { uuid?: string; parentUuid?: string | null };
      if (entry.uuid === promptId) return entry.parentUuid ?? null;
    } catch {}
  }
  return undefined;
}

// The thread from `from` on, folded into one item you can open to see the version you replaced.
export function foldFrom(items: readonly ThreadItem[], from: number, at: number): ThreadItem[] {
  return [...items.slice(0, from), { kind: "edited", items: items.slice(from), at }];
}
