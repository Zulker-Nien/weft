# Subagents

Every board thread is told when to hand work to a subagent, and Settings → **Use for subagents** picks the model they
run on. The point is context: a subagent's file reads and long outputs stay out of the thread, and independent ones run
at once. The copilot is left out (it runs the board, not code).

## Key files

| File | Role |
| --- | --- |
| `lib/subagents.ts` | The setting's values, the prompt text, and the env a CLI starts with |
| `lib/settings.ts` | `subagentModel()` / `setSubagentModel()`; stored in `~/.weft/settings.json`, absent means "choose" |
| `app/api/settings/route.ts` | `PATCH { subagentModel }`, validated with `isSubagentModel()` |
| `components/SubagentPicker.tsx` | The Settings row; saves on change, reverts and says why if the save fails |
| `components/ModelSelect.tsx` | The model menu it shares with Run /weft:done on (`DonePicker`): leading choices, then Claude and Puku headings from `MODELS`; `useSavedPick()` is the save-or-revert hook both rows use |
| `lib/runner-session.ts` | Appends `subagentPrompt()` to a thread's system prompt, merges `subagentEnv()` into its env, and counts the setting in a session's build so idle sessions restart when it changes |

## The setting

`SubagentModel` is `"choose"`, `"inherit"`, or a model id from `MODELS` in `lib/new-thread.ts` (Claude: Fable 5.1,
Opus 5.5, Sonnet 5.5, Haiku 5.5; Puku: Opus 4.8, Puku AI 2.8, Puku AI 2.7). The picker groups the ids under Claude and
Puku, so a new model added to `MODELS` shows up here without another edit. `subagentBackend(id)` says which CLI serves it.

| Pick | Prompt | Env |
| --- | --- | --- |
| Let the model choose (default) | delegate + a Haiku / Sonnet / Opus guide (Claude threads only) | none; the thread sets `model` per Agent call |
| Same model as the thread | delegate + "leave the model input out" | Claude: `CLAUDE_CODE_SUBAGENT_MODEL=inherit` + `_FORCE=1`; puku: none |
| A model the thread's own CLI serves | delegate + "Subagents run on X, leave the model input out" | Claude: `CLAUDE_CODE_SUBAGENT_MODEL=<id>` + `_FORCE=1`; puku: `PUKU_CLI_SUBAGENT_MODEL=<id>` |
| A model only the other CLI serves | delegate + how to run that CLI headless with Bash | none |

`CLAUDE_CODE_SUBAGENT_MODEL_FORCE` makes the Claude Code CLI drop the Agent tool's `model` input and ignore models set in
agent definitions, so the pick can't be overridden per call. `PUKU_CLI_SUBAGENT_MODEL` always wins in puku-cli. Both were
read from the bundled binaries' source, not from docs.

## Models from the other CLI

The Agent tool can only start subagents on the model family its own CLI serves. For the other CLI's models the prompt
tells the thread to run one headless through Bash:

```
puku-cli -p "<self-contained task>" --model opus-4.8 --allowedTools "Read Grep Glob" --permission-mode dontAsk
claude   -p "<self-contained task>" --model claude-haiku-5-5 --allowedTools "Read Grep Glob" --permission-mode dontAsk
```

stdout is the report. Read-only by default; the thread adds `Edit Write` to `--allowedTools` for a subagent that changes
files. Several Bash calls in one message run in parallel, and `run_in_background` covers long ones. A single read-only run
took about 13s on puku-cli and 17s on claude. If the other CLI isn't installed or logged in, the thread is told to say so
and use the Agent tool.

## Patterns

- The prompt and env are computed per session start. `currentBuild()` in `lib/runner-session.ts` hashes the thread
  prompt and the subagent model into a session's build, so a change in Settings replaces idle sessions (a busy turn keeps
  its CLI) and spares.
- Ids are validated against `MODELS`, never free text, so a typo can't reach `--model` or the env.
