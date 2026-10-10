# The library: recipes, to-dos and notes

Some cards are worth keeping after they're done: a media kit you'll want again for the next product,
setup steps you'll work through over a few days, an answer to look up later. Starring a card files it in
the library as one of three kinds:

| Kind | What it keeps | Opening it |
| --- | --- | --- |
| ↻ Recipe | The card's prompt, with the parts that change next time turned into `{blanks}` | The New thread dialog, filled in, with the recipe's page in the pane |
| ☑ To-do | The page the card's pane showed (images and all), with its checkboxes | That page in the pane; ticks are saved |
| ✎ Note | The same, for an answer you just want to keep | That page in the pane |

A starred card shows ★ and is never auto-archived (`archiveWhenIdle` and the Done automations in
`lib/runner.ts` skip it).

## Two levels, like Claude Code

"Mine" is yours in every project; "project" belongs to one folder.

| | Mine | Project |
| --- | --- | --- |
| Recipes | `~/.claude/skills/<name>/SKILL.md` | `<folder>/.claude/skills/<name>/SKILL.md` |
| To-dos, notes | `~/.weft/library/<id>/` | `~/.weft/library/projects/<slug>/<id>/` |

A recipe **is** a Claude Code skill, so it also runs as `/<name> <blank values…>` in plain Claude Code and in
the slash menu. To-dos and notes follow Claude's memory layout (`~/.claude/projects/<slug>`): personal and
outside the repo. `<slug>` is the folder path with every non-alphanumeric character as `-`.

Each scope folder has an `items.json` index (`LibraryItem` in `lib/types.ts`) and a folder per item holding
`index.html` and `files/` (the images and files the page pointed at, copied so the page outlives `/tmp`).
Weft marks the skills it writes (`SKILL_MARK`), and removing a recipe deletes its skill only if the mark is
still there, so a skill you edited or wrote yourself is never deleted.

## Pieces

- `lib/library.ts` (server): the store (`listLibrary`, `addItem`, `updateItem`, `removeItem`), starring
  (`starCard`), page bundling (`bundlePage`, `localAsset`), recipe drafting (`recipePrompt`,
  `parseRecipeDraft`, `skillMarkdown`) and the recipe page (`recipePage`).
- `lib/library-view.ts` (pure, browser-safe): how the rail groups and counts items, to-do progress,
  `{blank}` parsing, and the pinned preference.
- `lib/haiku.ts`: the one-shot Haiku call that `lib/glance.ts` also uses. Saving a recipe asks it to
  replace what changes next time with named blanks and add a hint for each (about 4s).
- `app/api/library/*`: list and star (`route.ts`); rename, refile and save ticks (`[id]/route.ts`); the page
  (`[id]/page`) and its files (`[id]/files/[name]`). Pages are served from Weft's own origin so their
  checkboxes can save with `fetch`. A CSP keeps scripts to the page's own; `electron/browser-pane.cjs`
  lets `/api/library/` through its "Weft can't open itself" check.
- `components/LibraryRail.tsx`: the 38px rail left of the columns (↻ ☑ ✎ with counts), and a 260px
  drawer that slides over the board, or sits beside it when pinned. "This project · Mine · All", a
  native menu on each row (move between Mine and the project, swap to-do and note, remove), and drop
  targets: drop a card on an icon to file it there. ⌘L opens it.
- Card menu (`lib/card-menu.ts`): Save as Recipe (`⇧R`), Star as To-do (`T`), Star as Note (`K`); a starred
  card gets Show in Library (`I`) and Unstar (`⇧K`).
- New thread (`components/NewCardDialog.tsx`): with a recipe, the prompt is the recipe's, the header says
  ↻ and its name, and both buttons stay off until no `{blank}` is left. The pane shows the recipe's page:
  its blanks with hints, what a run makes, its last runs (each a `weft://card/<id>` link) and their
  average time. With no recipe, the splash page lists the folder's recipes and yours as
  `weft://recipe/<id>` links (`newThreadPage` in `lib/glance.ts`); `electron/main.cjs` turns those into
  the `run-recipe` menu action.
- Instructions pages: `BROWSER_PROMPT` asks a thread to hand over steps for you as their own page, with
  checkboxes, commands, an inline SVG where a flow helps, and screenshots. `mcp__browser__screenshot`
  takes `save_to` (writes the PNG) and `highlight` (boxes the element to click in orange before the shot).
- Copilot (`lib/board-tools.ts`): `list_library`, and `create_card` takes a `recipe_id` (it refuses one
  with blanks left).

## Not yet

- The blanks are filled in the prompt only; the recipe page lists them but isn't an editable form.
- A live site in the pane (not a file) is kept as a link plus the card's last answer, not a snapshot.
- Starring always files a project card under its project; move it to Mine from the drawer's row menu.
