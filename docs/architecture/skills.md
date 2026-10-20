# Skills: one library, a set per card

A thread gets only the skills its work needs. Weft keeps one library of every skill it can find, each
project keeps a default set, and each card can change its own. Every runner gets the card's set in the
form it reads, when its CLI starts.

## The library (`lib/skill-library.ts`)

- **Weft's**: `plugin/skills`, loaded as the `weft` plugin, run as `/weft:<name>` (`lib/skills.ts`).
- **The project's**: `<folder>/.claude/skills`.
- **Yours**: `~/.claude/skills`.
- **Plugins**: what Claude Code installed (`~/.claude/plugins/installed_plugins.json`), less the ones your
  `enabledPlugins` already turns off. A plugin is one row, with its skill count, because it can only be
  switched as a whole (below).

Skills stay where they are; Weft never copies them.

## A project's default set (`lib/skill-sets.ts`)

`~/.weft/skill-sets.json` holds an **off-list** per folder: skill names (`tdac`) and plugin ids
(`posthog@posthog`). An off-list rather than an on-list, so a skill Weft doesn't know of (Claude Code's
bundled ones, a skill added later) stays on.

It's seeded once per folder (`ensureSeeded`, called as a spare opens there and when a drawer reads it)
from what that folder's threads ran (`lib/skill-usage.ts`): Weft's and the project's skills stay on;
a skill of yours, or a plugin, that no transcript ran goes off. The scan reads every transcript in
`~/.claude/projects/<folder>` and `~/.puku-cli/projects/<folder>` (Weft's own folder has over a GB),
in the background, caching each file's skills by size in `~/.weft/skill-usage.json`. A run counts as
a `<command-name>`, a Skill tool call, a typed `/name`, or the "Base directory for this skill" line a
skill Claude loaded itself leaves behind. Until the seed lands, threads there get everything.

## A card's set

`Card.skillsOn` / `Card.skillsOff` are the card's changes from its project's set; `offFor(card)` is
the project's off-list plus the card's off, less the card's on. `toggleCardSkill` stores the smallest
change, so a row put back to the project's value leaves no override.

## Runner adapters

`specFor` (`lib/runner-state.ts`) puts `offFor(card)` on `Spec.skillsOff`; the copilot keeps every skill.

| Runner | How it gets the set |
| --- | --- |
| Claude Code | `--settings` (`queryOptions` → `withSkillSettings`): `skillOverrides: {name: "user-invocable-only"}` for skills, `enabledPlugins: {id: false}` for plugins |
| puku | the same settings, plus `skillIndex(cwd, { off })` in its first message (`lib/puku-context.ts`), since it doesn't read `.claude/skills` |
| Codex | `skillIndex(cwd, { off })` in its first prompt (`lib/codex-runner-prompt.ts`) |

Checked against the CLI on 2026-10-19:

- `skillOverrides` takes bare names; a plugin-qualified key (`posthog:signals`) is ignored, so plugins
  go through `enabledPlugins`, keyed `name@marketplace`.
- `"user-invocable-only"` hides the skill from the model but `/name` still runs it, so an automation's
  `/skill` and one you type keep working. `skillInvocation` isn't filtered for the same reason.
- `applyFlagSettings` with these keys on a running session didn't change its listing, so a set is fixed
  when the CLI starts. Spares open with their folder's project set (`ensureSpare`); `adoptSpare` skips
  the spare when the card's off-list differs (`sameOff`), and that card starts its own CLI. A change to an
  idle card's set closes its CLI (`setCardSkill` → `endSession`); the next message resumes the session
  with the new set. A busy one picks it up the next time it starts.

## API and UI

- `GET /api/skills/set?cwd=` or `?card=` → `skillSetView` (`lib/skill-set-actions.ts`): a row per skill
  and plugin with `inProject`, `on` and `changedHere`. `PUT` `{ cwd | card, name, on }`.
- ✦ on the rail (`components/SkillsDrawer.tsx`): the board's project's default set.
- ✦N in a card header (`components/SkillsChip.tsx`): the card's set, N the skills its model sees
  (a plugin counts as its skills). Both draw `components/SkillSetList.tsx` from `lib/use-skill-set.ts`,
  laid out by `lib/skill-set-view.ts`.

## Still open

- A skills marketplace: search sources, preview a skill's files, install into a Weft-owned library
  folder (`~/.weft/skills`), then add it to a card, a project or every project.
- New skill from a card; the copilot's own set; applying a change to a running CLI if a later CLI
  re-reads `skillOverrides` mid-session; confirming puku-cli honours `skillOverrides` the way Claude Code
  does (it accepts the settings).
