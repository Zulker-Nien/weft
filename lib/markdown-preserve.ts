// When a markdown file round-trips through the TipTap editor, untouched paragraphs keep their bytes;
// only the lines the user changed should change on save. The editor's "edit" view gives a markdown
// string for any saved moment, and TipTap's serializer is close to — but not identical to — the
// source. We do a three-way diff between the file on disk, the editor's view of the same file
// (taken right after load), and the editor's view after the user has edited. Lines the editor
// reformatted but the user didn't touch are kept as they were; lines the user changed are saved as
// the editor's new form. A real conflict (both sides changed the same lines differently) takes the
// editor's version, because the user has the live view of what they meant.
//
// node-diff3 merges line arrays. We split on '\n' (preserving a trailing newline) so a file that
// ends in '\n' doesn't grow a phantom last empty line; the round-trip and the merge split and join
// identically.

import { diff3Merge } from "node-diff3";

function splitLines(text: string): string[] {
  if (text === "") return [];
  // Split keeping the '\n' on every line except the last; a file with no trailing newline keeps
  // its shape through merge.
  const lines = text.split("\n");
  return lines.map((line, i) => (i < lines.length - 1 ? `${line}\n` : line));
}

function joinLines(lines: string[]): string {
  return lines.join("");
}

export function preserveFormatting(
  // The file as it sits on disk right now.
  original: string,
  // The file as TipTap rendered it the moment we loaded it (the "baseline" of the editor's
  // canonical form for this content). Re-serializing the same content twice in a row gives this.
  roundTrippedOriginal: string,
  // The file as TipTap renders it now, after the user's edits.
  roundTrippedEdited: string,
): string {
  // The user hasn't changed anything: keep the file's bytes exactly so an inadvertent save doesn't
  // touch the file. TipTap's round-trip is the right output for the same content, but only the
  // author's bytes are guaranteed to be byte-identical.
  if (roundTrippedOriginal === roundTrippedEdited) return original;
  // The editor couldn't even reproduce its own baseline from `original`; we have nothing safe to
  // merge against. Fall back to the edited form — better than refusing the save.
  if (roundTrippedOriginal === original) {
    return roundTrippedEdited;
  }
  const a = splitLines(roundTrippedEdited);
  const o = splitLines(roundTrippedOriginal);
  const b = splitLines(original);
  const regions = diff3Merge(a, o, b, { excludeFalseConflicts: true });
  const out: string[] = [];
  for (const region of regions) {
    if (region.ok) {
      for (const line of region.ok) out.push(line);
    } else if (region.conflict) {
      // Conflicting change: take the editor's version (a) because the user is looking at it.
      for (const line of region.conflict.a) out.push(line);
    }
  }
  return joinLines(out);
}
