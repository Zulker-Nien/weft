# Copilot personas

The copilot is one card (`id: "copilot"`, `role: "copilot"`, lib/copilot.ts) with one set of board tools. A persona changes how it
thinks and what it looks like, not what it can do: **Wingman** (the default, runs the board), **Founder** (tests a business before
you build it, after [founder-skill](https://github.com/Jakeschincariol/founder-skill), MIT) and **Captain** (runs work as a sprint,
after [gstack](https://github.com/garrytan/gstack), MIT). Their methods are adapted, not their voices; the prompts credit both.

## Key files

- `lib/copilot-personas.ts`: `PERSONAS` (name, tagline, prompt, picture and its three crops), `PERSONA_ORDER`, `isPersona`,
  `personaOf` (Wingman for none or unknown), `PERSONA_PROMPTS` (every prompt joined, for the build fingerprint).
- `lib/types-card-detail.ts`: `Card.persona`, set only on the copilot card; Wingman is stored as no persona.
- `lib/runner-state.ts`: `specFor` copies the persona onto `Spec.persona` for the copilot only.
- `lib/weft-prompts.ts`: the copilot's system prompt is soul + browser + `COPILOT_PROMPT` + the persona's prompt (nothing for
  Wingman); the memo key includes the persona; `WEFT_PINNED_PROMPTS.COPILOT_PERSONA_PROMPTS` puts every persona's text into the
  prompt fingerprint, so editing one replaces idle copilot CLIs.
- `lib/copilot.ts` `setCopilotPersona` + `app/api/copilot/persona/route.ts` + `api.copilotPersona`: set the persona, then `resetCopilot`.
- `lib/use-copilot-thread.ts` `setPersona`: clears the thread and shares the New chat lock (`resetting`).
- `components/CopilotPersonaMenu.tsx`: the picker, the persona's name in the lane header; `CopilotLane`, `CopilotHider` and
  `CopilotPeek` draw the persona's picture and name. Pictures are in `public/copilots/` (`wingman.jpg`; `founder.svg` and
  `captain.svg` are drawn placeholders with the emblem at 600,344 of 1200x800).

## Data flow

Pick in the menu → `POST /api/copilot/persona` (guarded, body `{ persona }`, anything else is 400) → `updateCard(persona)` →
`resetCopilot()` ends the CLI, clears the thread and warms a new one → the new CLI starts with the persona's prompt.

## Patterns

- The CLI reads its system prompt only when it starts, so a switch always starts a new chat; the old conversation isn't kept.
- Puku and Codex don't use personas: the copilot is Claude Code only.
- Founder and Captain tell the copilot to have threads run the real skills when a project has them installed (`/founder-board`,
  `/office-hours`, `/review`, `/qa`, `/ship`), and otherwise to put the step's method in the thread's prompt.
