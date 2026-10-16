// The ReplyBox's placeholder text: the question prompt, the "working" line, or the suggestion
// with the Tab cue. Pure, so a test can pin the rules.
export function replyPlaceholder(live: boolean, suggestion: string | undefined, fallback: string, question: boolean): string {
  if (question) return "Type your own answer, or a note on your pick. Enter answers.";
  if (live) return "Working. Write the next message and it'll send when this turn is done.";
  return suggestion ? `${suggestion}  ⇥ Tab` : fallback;
}