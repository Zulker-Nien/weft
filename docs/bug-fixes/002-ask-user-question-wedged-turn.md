# 002 — `AskUserQuestion` wedged a turn with no way to answer

- **Date:** 2026-10-09
- **Severity:** Medium (a turn could hang with no way to answer)

## Symptom

When an agent called Claude Code's `AskUserQuestion` tool, the card sat in **Needs you** showing the raw tool input as JSON, with only **Allow** and **Deny** buttons. The turn stayed busy and the card stayed in Needs you for 4+ minutes, and any attempt to reply came back with `400 "This thread is already running"`. Only denying the request got the agent moving again (it then asked its question in plain text).

## Root Cause

The SDK delivers every tool request — permissions *and* `AskUserQuestion` — through the same `canUseTool` callback (`lib/runner.ts`). The board treated them all as permission questions: it rendered Allow/Deny with the raw input, and Allow resolved the pending request with `{ behavior: "allow", updatedInput: input }` — no `answers` ever reached the tool, so the question was never actually answered.

The pre-fix resolution for an `AskUserQuestion` looked effectively like:

```ts
// lib/runner.ts — settle() pre-fix branch
p.resolve(
  allow
    ? { behavior: "allow", updatedInput: p.input }           // no answers
    : { behavior: "deny", message: "The user denied this in Weft." },
);
```

Nothing on the route side could ask the user *which* option to pick, so the turn hung.

## Why It Was Hard to Find

`AskUserQuestion` is a real SDK tool, not a permission prompt, but it shows up in the same `canUseTool` stream as `Bash` and the like. A code path that worked for "ask to run a command" silently produced a stuck card for "ask the user a question."

## The Fix

`askUser` in `lib/runner.ts` detects `AskUserQuestion` and parses its input into structured `questions`. The board renders a real question UI; `settle` returns the chosen answer(s) as `updatedInput`.

```ts
// lib/runner.ts — askUser
const questions = toolName === "AskUserQuestion" ? readQuestions(input) : undefined;
```

```ts
// lib/runner.ts — settle() with answers branch
if (p.questions) {
  p.resolve(
    allow && answers
      ? { behavior: "allow", updatedInput: { ...p.input, answers } }
      : { behavior: "deny", message: "The user skipped the question." },
  );
}
```

The question text maps to the chosen label(s), comma-joined. The permission API also takes a `pendingId` so a double-click can't answer the next request:

```ts
// lib/runner.ts
export function answerPermission(
  cardId: string,
  allow: boolean,
  answers?: Record<string, string>,
  pendingId?: string,
) { ... }
```

UI side: `components/QuestionForm.tsx` shows the parsed options plus a free-text "Something else" box, `components/ThreadView.tsx` renders it for the permission row, and `components/CardView.tsx` exposes an **Answer** button that opens the form.

**Verified end to end:** the card showed *"Do you prefer red or blue?"* with **Red** / **Blue** options; answering **Blue** let the agent reply *"You picked blue."* and the card moved itself to **Done**.

## Key Rule

A tool the SDK routes through `canUseTool` isn't necessarily a permission question — check the tool name and give the user the UI the tool actually needs.

## Files Involved

- `lib/runner.ts`
- `components/QuestionForm.tsx`
- `components/ThreadView.tsx`
- `components/CardView.tsx`
- `app/api/cards/[id]/permission/route.ts`
