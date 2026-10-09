// Threads end each reply with a line like
//   BOARD STATUS: column=review | stage=First shot | remaining=add a test, commit
// (the format is set by the thread instructions in lib/settings.ts). The board reads it
// to move the card, and strips it from what it shows.

export type StatusColumn = "needs_you" | "review" | "done";

export interface BoardStatus {
  column: StatusColumn;
  stage?: string;
  remaining?: string;
}

const STATUS_LINE = /^[\s>*_`]*BOARD STATUS:\s*(.*?)[\s*_`]*$/i;

function normalizeColumn(raw: string | undefined): StatusColumn | undefined {
  const value = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (value === "needs_you" || value === "review" || value === "done") return value;
  return undefined;
}

function parseFields(raw: string): BoardStatus | undefined {
  const fields: Record<string, string> = {};
  for (const part of raw.split("|")) {
    const at = part.indexOf("=");
    if (at === -1) continue;
    fields[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim();
  }
  const column = normalizeColumn(fields.column);
  if (!column) return undefined;
  const remaining = fields.remaining && !/^none\.?$/i.test(fields.remaining) ? fields.remaining : undefined;
  return { column, stage: fields.stage || undefined, remaining };
}

// Returns the text without any BOARD STATUS lines, and the last valid status found.
export function extractStatus(text: string): { text: string; status?: BoardStatus } {
  let status: BoardStatus | undefined;
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const match = line.match(STATUS_LINE);
    if (match) {
      status = parseFields(match[1]) ?? status;
      continue;
    }
    kept.push(line);
  }
  // Removing the line can leave a double blank line behind; fold it back to one.
  return { text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd(), status };
}
