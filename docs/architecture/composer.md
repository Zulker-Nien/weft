# The reply box's modes

The reply box under a thread (`components/ThreadFooter.tsx` → `components/ReplyBox.tsx` → `components/Composer.tsx`)
does different things on Enter depending on the thread: send, queue behind a running turn, answer a question, run
a `!` command, replace the last message. It used to say which only through the placeholder, a tooltip or a sentence
above the box, with the same blue ➤ for all of them. Now the box is in **one mode at a time**, and the mode is named
twice: on a chip inside the box's frame and on the primary button.

## The rule

`lib/reply-mode.ts` is pure and tested to 100%. `replyBoxMode()` reads the box's props and state (live, question,
`!` command, ↑ editing, empty box, the card's cache and 5-hour window, a cut-off last turn) and returns a
`ReplyModeView`:

| Mode | Chip | Primary (Enter) | ▾ menu |
|---|---|---|---|
| reply | none | **Send** | Continue here (after a cut-off turn), Send later… |
| reply, empty box, cut-off turn | none | **Continue** | Send later… |
| reply, cache cold | Cache cold · 184k | **New card** | Send here · re-sends 184k, Continue here, Send later… |
| reply, 5h used up | 5-hour limit used up | **Send at 10:39pm** | Send now anyway, Continue in new card (if cold), Send later… |
| queue | Queue · after this turn | **Queue** | Send now (stops the turn), Send later… |
| answer | Answer | **Answer** | none |
| shell | Shell · *folder* | **Run** (green) | none |
| replace | Replace last message · N file edits stay · Esc | **Replace** (amber) | none |
| copy | Editing a copy · this thread can't rewind · Esc | **Send copy** | none |

The modes take precedence in the order edit, shell, question, live, idle. Each item names a `ReplyAction`;
`ReplyBox` routes it (`onAction`) to the existing paths: `submit`, the question form's `enter`, `sendContinue`
(`lib/use-reply-continue.ts`), `scheduleAt` (`lib/use-reply-schedule.ts`) or the hand-off (`lib/handoff.ts`).
Enter runs the primary, except it won't start a new card from an empty box (that takes a click).

- **Cut off** is `turnCutOff(card)`: `card.error`, a last line starting "Stopped" (a stop, or the app closing),
  `rateLimitHit` or `interrupted`. ⌘. still sends "continue" whenever the thread is idle.
- **Limit used up** is `limitResetAt(card.stats.fiveHour, resets.fiveHour, now)`: the window at 100%, with its own
  reset (unix seconds) when it's still ahead, else the plan's next one. Only where Send later is offered.
- **Cold** is the card's `stats.cache` with no minutes left (`cacheMinutesLeft`), only while idle and only where the
  transport offers the hand-off.

## The pieces

- `components/ReplyButtons.tsx`: ■ Stop in its own slot while a turn runs (so nothing shifts when one starts), then
  the split primary (label, ↵, ▾) and its menu.
- `components/ReplyModeChip.tsx`: the chip (`Composer`'s `header` slot) and the frame's border for shell (green) and
  replace (amber). A plain reply has no chip, to keep the box short.
- `components/SendLater.tsx` `bare`: the time picker without its own clock button; the ▾ menu or ⌥↵ opens it.
- `lib/use-reply-draft.ts` reports `empty` along with `shell`.

## Not built yet

The audit that led here (every state, drawn) is in the thread's page `~/.weft/show/composer-states/`. Still open:

- **One dock for every ask.** Questions, permissions, folder grants, symbol claims and secret asks inside the reply
  box's frame, one at a time, with numbered options, Enter/Esc and a note; the field stays the same Composer (never
  remounted), the frame grows upward around it, and a draft is kept with "↓ Send it after the answer".
- **One server-side queue.** Drop ReplyBox's in-memory `queue` (and "Paused") for the runner's `afterTurn` messages.
- **Fewer bands.** The task strip as a chip on the status line, one error slot, key hints in the placeholder.
