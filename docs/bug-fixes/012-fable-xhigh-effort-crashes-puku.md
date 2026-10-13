# 012: flipping a Fable card to puku with xhigh effort crashed puku-cli

- **Date:** 2026-10-13
- **Severity:** Medium (the card looked fine after the switch; the crash happened on the *next* turn, surfacing as a process-exit error line. No data loss, but the card was unusable until manually recovered.)

## Symptom

A card created on Claude Code with `effort: "xhigh"` was switched to puku via the new thread-header
picker. The badge re-rendered correctly, but the next message produced:

```
Claude Code process exited with code 1. stderr: error: option '--effort <level>'
argument 'xhigh' is invalid. It must be one of: low, medium, high, max
```

The card got stuck in this state: the picker would flip it again to the same target, the error
would repeat, and the user had no in-app way to clear the bad `effort` value. (Restarting Weft
didn't help — the value lived in `board.json`.) Confirmed on the card `📧 Forward weft.zip mail
to Gmail via Resend` (id `37c9b89b-…`).

## Root cause

Three places translate a card's `effort` into a CLI flag. None of them agreed, and none of them
matched puku-cli's actual accepted set.

1. **`app/api/cards/route.ts`** — at card creation, the effort was dropped to `undefined` for any
   non-Claude backend:
   ```ts
   const effort = backend === "claude" && EFFORTS.includes(body.effort as Effort) ? (body.effort as Effort) : undefined;
   ```
   Puku accepts `low/medium/high/max` perfectly well; this branch threw them all away.

2. **`lib/backend-switch.ts`** — when flipping a card's CLI, `effort` was copied through untouched,
   with no normalization at all. A `claude → puku` switch left an `xhigh` in place.

3. **`lib/runner-state.ts specFor()`** — the place the runner actually reads to build the CLI's
   `--effort` flag — read `card.effort` raw. So even if the user re-saved the card with the
   correct effort, the in-memory `Spec` was rebuilt from the unchanged card on every turn.

The three together meant: a card created before any fix was applied would fail forever, regardless
of the picker or the rate-limit escape hatch.

## The fix

One source of truth, used in all three places. `lib/new-thread.ts`:

```ts
const EFFORT_BY_BACKEND: Record<Backend, Effort[]> = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  puku:   ["low", "medium", "high", "max"],
};

export function effortFor(backend: Backend, effort: Effort | "" | undefined): Effort | undefined {
  if (!effort) return undefined;
  const allowed = EFFORT_BY_BACKEND[backend];
  if (allowed.includes(effort)) return effort;
  // Walk down the Claude effort ladder until we land on one puku accepts.
  const claudeOrder: Effort[] = ["low", "medium", "high", "xhigh", "max"];
  const idx = claudeOrder.indexOf(effort);
  if (idx === -1) return undefined;
  for (let i = idx; i >= 0; i--) {
    const candidate = claudeOrder[i];
    if (candidate && allowed.includes(candidate)) return candidate;
  }
  return undefined;
}
```

Then route every translation through it:

- `app/api/cards/route.ts` — replaces the inline `backend === "claude" && EFFORTS.includes(...)`
  with `effortFor(backend, body.effort)`. New cards can't get into a bad state.
- `lib/backend-switch.ts` — uses `effortFor` to normalize after a switch, so the card's stored
  effort is rewritten to one the target CLI accepts.
- `lib/runner-state.ts specFor()` — normalizes through `effortFor` at the moment the spec the
  CLI actually runs with is built. **This is the catch-all that recovers cards already in a
  bad state.** Your `37c9b89b` had `effort: "xhigh"` baked in; with this fix the next turn
  launches puku with `--effort high` and the card recovers without any user action.

The card's stored `effort` is intentionally *not* rewritten by `specFor` (we don't write on
read). To clean the stored field too, flip the card to Claude and back to Puku with the picker:
that goes through `switchBackend`, which does write.

## Tests

- `lib/new-thread.test.ts` — replaces the old "puku ignores effort" test with one that pins the
  real per-backend mapping, including the `xhigh → high` fall-back.
- `lib/switch-backend.test.ts` — adds three: `claude xhigh → puku` drops to `high`, `claude max → puku`
  stays `max`, and `puku high → claude` stays `high` (the picker is symmetric; never invent
  `xhigh`).
- `app/api/routes.test.ts` — the "keeps the model for puku but ignores effort" case is replaced
  with one that pins the real behavior: puku keeps `high`, drops `xhigh → high`.
- `components/NewCardDialog.test.tsx` — the "puku-cli takes no effort" case is replaced with
  one that pins the real behavior: puku keeps `high`.

372/372 pass.

## Lesson

A value that crosses a backend boundary needs one translation function, used at every site that
hands it to the other side — not three branches, each with its own idea of what's valid. The
first attempt at this fix put the guard in `switchBackend` only, and that left the in-memory
runner reading the raw card. Pushing the guard down to `specFor` (the lowest point the value
reaches the CLI) catches every path: new cards, switched cards, and cards left over from
before the guard existed.
