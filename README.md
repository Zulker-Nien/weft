# Weft

A board for your AI. Weft is a Trello-style board where each card is an AI CLI
thread (Claude Code or puku-cli), with a browser pane on the side that you and the agents can both
use, and a copilot in its own small window that can see and run the board.

In weaving, the weft is the thread that runs across the loom and binds the separate threads into
cloth.

## Run it

```bash
git clone https://github.com/aimhuge/weft.git && cd weft
npm install
npm run desktop     # Electron app: board + side browser
npm run dev         # board only, in a normal browser at http://127.0.0.1:1000 (no browser pane)
npm test            # unit tests (Vitest), about a second; npm run lint for ESLint
```

The first `npm run desktop` downloads the Electron binary. Don't run `dev` and `desktop` at the
same time; Next.js allows one dev server per project folder.

## The desktop app

- **Closing the window keeps Weft running**, with your threads' CLIs open, so conversations stay
  alive. ⌘Q quits. Opening Weft again just brings the existing window forward.
- **⌃⌥Space** opens the copilot from any app. In the app: ⌘N new thread, ⌘J copilot, ⇧⌘B
  browser pane, ⌘F find cards, ⌘, settings, ⌘1 board, ⌘2 copilot.
- **Shortcuts sheet**: `?` (or the "? Shortcuts" link in the footer) lists every shortcut in the app,
  board, thread, composer, terminal and app menu, and searches them by what they do or by key ("archive",
  "cmd k", "esc"). Hold ⌘ on the board for a moment, or Shift, and a card lists what that modifier does.
  Buttons, the filter box and right-click menus show their keys too.
- **Full screen threads**: clicking a card opens its thread and its browser together in one large
  overlay over the board; Esc (or clicking outside) closes it, and so does sending `/done`.
- **Browser pane zoom**: the % button in the pane's toolbar zooms the page (Chrome's steps, plus
  50–200% presets); ⌘+ / ⌘− / ⌘0 and ⌘+scroll work on the page too, and a trackpad pinch magnifies.
- **Menu bar icon**: shows how many cards need you and lists them; click one to open it.
- **Dock**: the Needs you count on the icon, and New Thread and Copilot in its menu.
- **Links**: `weft://new?prompt=…&folder=…&start=1` creates a card (in your most recent project
  if no folder is given), `weft://card/<id>` opens one, `weft://copilot` opens the copilot. Handy
  from Alfred, Raycast, or Shortcuts. (Registered by the packaged app.)
- The window remembers its size and position, and the app reads your login shell's PATH, so it
  finds `claude` and `puku-cli` even when started from Finder.
- If the server crashes, it restarts on its own; its output is in `~/Library/Logs/Weft/server.log`
  (Help → Open Logs Folder).

## Your existing Claude Code threads

On launch and every minute after, Weft picks up your Claude Code sessions (the ones
`claude --resume` and the Claude app list) as cards, read-only from `~/.claude/projects`:

- A title like "GOING DEEPER - Weft desktop app" becomes the card "Weft desktop app" with stage
  "Going deeper". DONE threads go to Done; other status words, and threads active in the last three
  days, go to Review; the rest go to Done. Their folders fill the projects bar.
- Opening a card shows the conversation, read from the session file.
- Replying continues the same session. If the session is open in the Claude app or a terminal,
  or changed outside Weft in the last 10 minutes, Weft continues it as a copy instead, so two
  apps never write to one session. "Click here to continue" in the thread's banner stops that
  outside Claude CLI, so the next reply continues the same session in Weft.
- Deleting a picked-up card hides that session for good. Sessions in temporary folders (tests,
  tool runs) are skipped.

Weft's own threads run with a clean environment (no variables inherited from a Claude session it
was started from) and are marked as SDK sessions, so they don't show up in the Claude app's list.

## Reading a thread

- Messages render as Markdown, with a Copy button on code blocks.
- A run of tool calls folds into one line like "Ran 3 commands, read 2 files +1"; click it to see each call and its output. Failed, denied and waiting calls are counted on the line.
- Images show inline: screenshots tools took, images pasted into Claude Code, and local images an agent shows with `![](path)` (copied into `~/.weft/attachments`). Click one to see it full size.
- Sessions running in another app move to Running (busy) or Needs you (waiting for an answer) on their own, within about 5 seconds, and go back to Review when the turn ends.

## Writing a prompt

The new-thread dialog (⌘N) and every card's reply box use the same editor:

- **Markdown, formatted as you type.** `## ` makes a heading, `- ` a list, ⌘B/⌘I bold and italic;
  the bar has the rest. The Markdown button shows the raw Markdown, which is what the agent gets.
  Pasted Markdown is formatted too.
- **Images and videos go where you paste or drop them**, not in a tray on top. They're saved to
  `~/.weft/attachments` and written into the prompt as `![name](path)`. Images also reach the agent
  as images at that spot (shrunk with `sips` if over the API's 5 MB limit); videos and other files
  go as paths the agent can open.
- **The mic dictates** on this Mac with whisper.cpp: click it, talk, click again, and the text lands
  at the cursor (Esc throws the recording away). It needs `brew install whisper-cpp ffmpeg` and a
  model; it uses superwhisper's or Homebrew's models, or the one in `WEFT_WHISPER_MODEL`. In a
  normal browser tab without whisper it falls back to the browser's speech recognition.
- **Drafts are kept** per card and for the new-thread dialog until sent, so closing it loses nothing.
- **Send later.** The clock beside Send (Alt+Enter) holds a reply until a time you pick. On a Claude
  thread the first choice is a minute after the 5-hour limit resets (the time in the bottom bar), so
  a message written when you hit the limit goes out as the new window opens; there's also "In 1
  hour", "Tomorrow morning" and any date and time. Scheduled replies sit above the box (click one to
  edit it) and show as a clock on the card. Weft sends them itself, with the thread closed; one that
  came due while Weft was shut goes when it next starts.
- In a reply, Enter sends and Shift+Enter starts a new line (Enter in a list or code block starts a
  new line too). In the new-thread dialog, ⌘↵ starts the thread.

The folder picker lists your recent projects, the git repos in `~/dev` and other usual code folders
(with their branch), and your GitHub repos from `gh`. Picking a GitHub repo that isn't on this Mac
clones it into `~/dev`. You can also paste a path or browse for a folder. Cards are titled from the
prompt's first line (click the title in the open thread to rename it), and new threads start in the default permission mode from Settings (Auto at first: a classifier
approves or asks); the menu next to the CLI switch changes that per thread. Effort starts at High and
then follows whatever the last new thread used. To change it later, even mid-turn,
use the mode menu in the open thread's header or the card's right-click menu. Sessions picked up from
Claude Code keep the mode they last ran in (say `auto`).

## How cards move

| Column    | How a card gets there |
|-----------|-----------------------|
| Backlog   | You create it with "Add to backlog" |
| Running   | You drag it from Backlog, press "Start now", or reply in its thread |
| Needs you | The agent asks permission for a tool; Allow or Deny on the card |
| Review    | The turn finishes (or fails, or you stop it) |
| Done      | You drag it there, and its Done automations run (by default `/weft:done`) |

The Backlog column is hidden by default. Turn it on with Settings → Show backlog. It also shows
whenever cards are waiting in it.

Replying to a card continues the same CLI session, so the agent keeps its context.

Right-click a card for a native menu where everything is one click: open, rename, start, move to
Review, Done or Backlog, stop, run `/weft:done`, `/weft:commit` or `/weft:preview`, start, restart or
stop its dev server, start a new thread in its folder, reveal the folder in Finder, copy the folder path
or a `claude --resume` command, archive, and delete. Right-click a column's empty space for New thread;
in Done, also show or hide archived cards and archive all the Done cards on screen. Every item has a key,
shown beside it, that picks it while the menu is open: right-click, then `D` for Done, `1` for `/weft:done`,
`Y` for YOLO. (Desktop app only.)

Archive from the keyboard: `Shift+A` archives the card you've moved to with `j`/`k`, or else the
open thread, and focus steps to the next card, so `Shift+A` three times clears three cards. `Shift+E`
archives every Done card on screen, and `Z` (or the toast's Undo) brings back the last archive. The command palette (`Cmd+K`) has all of them too.

Cards get no git worktree of their own, on purpose, so two cards in one folder share a working tree.
Weft warns you instead: a busy card shows "+1 here" next to its folder when another card is running
or waiting in the same folder (or one inside it), and a thread's reply box says "Also running here:
<title>" before you send. The New thread dialog says the same beside Start now when the folder you
picked already has a busy card. When the busy cards there have edited the same files, the reply box
names them too: "Also running here: Fix login — both edited a.ts". Each card remembers the files its
thread edited (the last 50, for the card's whole life, since Weft can't cheaply tell what got committed).
It reads all this from the board alone, with no git calls.

## No waiting for CLIs to start

A CLI takes 12–50s to start with a full Claude Code setup (MCP servers, plugins, hooks), so the
board starts them before you need them:

- Each thread's CLI stays open between turns, so a reply starts in about two seconds. By default
  it stays open until the app quits (Settings → Keep conversations open).
- On launch, the copilot's CLI starts, plus a spare CLI in your most recent project.
- Picking a project, opening the new-thread dialog, or opening a card starts a CLI for it in the
  background. A new card takes over the spare in its folder (up to three spares are kept).

## Board status

Every thread's system prompt (editable in Settings → Thread instructions) asks it to end each
reply with a line like `BOARD STATUS: column=review | stage=First shot | remaining=add a test`.
The board strips that line, moves the card to the column the thread reports (Needs you, Review, or
Done), and shows the stage and what's left on the card. When a thread asks a question with its
AskUserQuestion tool, the card shows the question and its options instead of Allow and Deny.

A card leads with what the thread last said, under its title, beside its latest picture: a
screenshot or image from the thread, or a capture of its browser pane taken after each turn (hover
to see it bigger; a badge counts the thread's images). A card with no picture shows an emoji Haiku
picks from its title, or its folder's initial until then. Below that, eight dots show how far
through the stages it is (Planning to Done) with what's left, and the footer reads
`● weft 12m · 1t · $1.22` (the dot is the CLI: orange for claude, purple for puku).

## Skills and automations

Weft ships its own skills in `plugin/`, a Claude Code plugin named `weft` that every board thread
loads, so they run as `/weft:<name>`:

- `/weft:done` wraps up a thread: architecture docs, lint, tests, then a commit of the files the
  thread changed. A copy of the `done` skill from `fotoflo/claude-skills`.
- `/weft:commit` commits the thread's changes with a conventional message (the `commit` skill,
  without its Vercel preview deploy).

Settings → Skills and automations holds rules of the form "When … run …":

- **a thread starts**: the skill is named in the thread's first message ("Start by using the /x
  skill"), so it runs with the task in view.
- **you move a card to Review / Done**: the skill runs in the card's thread as its own turn, as if
  you'd typed `/<skill>`. Several rules for one move run one after another; a turn that's stopped
  or fails drops the rest, and one that ends needing you waits for your reply.
- **a prompt matches**: a case-insensitive regex (e.g. `vercel|deploy`) is tested against each
  message you send in a thread. On a match the skill runs as its own turn right after, once per
  thread per skill. An invalid pattern never matches, and Settings refuses to save one.

A new install starts with one rule: moving a card to Done runs `/weft:done`. Moves only run
skills on cards that have already run (and, for picked-up sessions, that Weft has run), and only
your own moves count: the copilot's moves and a thread reporting `column=done` don't, so the done
skill can't trigger itself. The rule's skill can be one of Weft's, one of yours in
`~/.claude/skills`, or a project's own (it then only runs in projects that have it).

Each card's **Skills** button lists the skills its thread can run (Weft's, the project's, and
yours) and sends the one you pick.

## Projects, filter, and sort

The bar under the header lists your most recent project folders. Click one to see only its cards;
More lists every project, opens a folder, or creates a new one. Filter and sort controls sit on
the right: press `/` to filter, and while you type a short list of matching cards drops down (↑↓ and
Enter open one), ending in a row that carries your text into the ⌘K palette to search prompts,
projects and commands too. New threads default to the selected project. The New thread dialog drags by its header and
resizes from any edge or corner; it stays inside the window and remembers its size and position.

The header shows test coverage ("49% coverage") of the project in view: the open card's folder,
else the selected project, else your latest card's. Hover it for lines, statements, functions and
branches and when it was measured. It reads `coverage/coverage-summary.json` at the project's root
(`npm run coverage` in a Vitest or Jest repo with the json-summary reporter); without one it
becomes a **Set up coverage** button that starts a thread in that folder to add a test runner with
coverage (`/weft:setup-done`) and run it once.

## Logging in

When a thread fails because its CLI isn't logged in, the board runs `<cli> auth login` in the
background and pops up a login window with the login page link, the CLI's output, and a box for
pasting a code. If the CLI needs a real terminal, it opens Terminal with the login command instead.
Once `auth status` reports you're logged in, the thread runs again. Settings shows each CLI's
login status. The app also sends a desktop notification when a card needs you or finishes while
it isn't focused, and shows the Needs you count on the dock icon. A card that moves to Needs you,
Review or Done without you keeps an accent tint and a pulsing dot until you open it.

## Library: recipes, to-dos and notes

Star the cards worth keeping. Right-click a card (or drag it onto the rail at the board's left edge):

- **Save as Recipe** turns its prompt into one you can run again: Haiku swaps what changes next time for
  `{blanks}` like `{product}`. A recipe is a Claude Code skill, in `~/.claude/skills` (Mine) or the
  project's `.claude/skills`, so `/media-kit Zeph` works in any Claude Code too. Click **Run** and the
  New thread dialog opens filled in, with the recipe's page in the pane: its blanks, what it makes, and
  its last runs. The plain New thread page lists your recipes too.
- **Star as To-do** keeps the page the card showed, with its images, as a checklist whose ticks are saved,
  so you can work through setup steps over days. Threads write steps for you as their own page, with
  screenshots (the screenshot tool can save them and box what to click) and diagrams.
- **Star as Note** keeps an answer.

⌘L opens the library; it slides over the board or, pinned, sits beside it. "This project · Mine · All"
picks what it shows. A starred card shows ★ and is never auto-archived. The copilot can list the library
and run a recipe. More in [docs/architecture/library.md](docs/architecture/library.md).

## Copilot

Press ⌘J (or the Copilot button) to open the copilot, an orchestrator thread in its own window.
It uses `mcp__board__*` tools to list cards, read threads, create cards, start them, reply to
them, move and stop them, and answer their permission requests. Reading and rearranging the board
happen without asking; starting a thread, replying to one, or answering for one asks you first in
the copilot window. Each message you send it also carries a short note, which only the copilot
sees, of what finished, needs you or failed on the board since your last message
(`lib/copilot-digest.ts`); nothing runs a copilot turn on its own. "New chat" starts a fresh copilot session. In a normal browser tab the
copilot opens as a pop-up at `/copilot`.

## Terminal

Press Control-backtick (⌃\`, as in VS Code) anywhere, `t` on the board, View > Terminal, or the terminal button in the header to
open a real shell in a drawer along the bottom of the window, for the commands a thread wasn't
allowed to run. Each folder gets its own shell: the drawer shows the open card's folder, else the
selected project's, else the latest card's, and switching project or card switches shell. Hidden or
switched-away shells keep running with their output. Split (or ⌘\\ in a terminal) adds a shell side
by side, up to three per folder; hover a terminal for its restart and close buttons. It's your login shell on a pty (`node-pty`, `electron/terminal.cjs`), drawn
with xterm.js (`components/TerminalDrawer.tsx`). Desktop app only.

## How it fits together

- `electron/main.cjs` starts the Next.js server, shows it in a window, and hosts the side browser
  as a native `WebContentsView`. Agents reach that pane through a token-protected control server on
  127.0.0.1; the board reaches it over IPC (`electron/preload.cjs`).
- `lib/runner.ts` runs each thread with the Claude Agent SDK (`query()` with streaming input, one
  CLI process per thread), streams messages to the board, and routes permission prompts to the card. For puku-cli it points the SDK at the
  `puku-cli` binary (`pathToClaudeCodeExecutable`).
- `lib/board-tools.ts` gives the copilot its board tools, and every board thread a small `board`
  server with just `list_cards` and `create_card` (a card made this way records its `parentId`; `list_cards` prints
  one line per open card, newest first, and lists done and archived ones only with `include_done`); `lib/copilot.ts` keeps its thread, which
  has the fixed id `copilot` and is left off the board.
- `plugin/` is Weft's own skills, loaded into every board thread with the SDK's `plugins` option;
  `lib/skills.ts` lists them with yours and a project's. `lib/automations.ts` turns the Settings
  rules into messages, and `queueMessages()` in `lib/runner.ts` runs them one turn at a time.
- `lib/browser-tools.ts` gives every thread `mcp__browser__*` tools (open_url, read_page,
  screenshot, click, type_text) that drive the side pane. They're allowed without a prompt.
- `lib/glance.ts` keeps the pane from ever being empty or stale. A card whose pane has no page gets a
  working page the moment its turn starts: a dimmed, slowly drifting scene of the Weft hovercar (one per card, from
  `electron/assets/backdrop-*.jpg` plus the splash's desert) behind the card's title, your ask with pasted images as
  thumbnails, and a running clock; the splash screen's desert scene sits beside the New thread
  dialog while you write the prompt, and starting the thread opens its card. A turn that ends without opening
  anything in the pane gets a teammate's update page (how it's going, what we did, what's next),
  written in the background by Haiku with a bare CLI (~12s) and opened in that card's pane. A live app
  (an http page) and pages the thread opened itself are left alone. Pages live in `~/.weft/glance/`.
- `electron/pane-pages.cjs` remembers each card's page in `~/.weft/pages/index.json` (pages a thread wrote to
  `/tmp` are copied beside it), so a card opened after a restart shows its last page again, or its last
  update page when that page won't load (a dev server that isn't running).
- `app/api/*` is the backend: cards, threads, permissions, and a server-sent events stream
  (`/api/events`) that keeps the board live. Every route only answers requests addressed to
  127.0.0.1/localhost, and writes need an `x-threadboard` header, so other websites can't drive it.
- Cards live in `~/.weft/board.json`, thread views in `~/.weft/threads/`. The CLIs keep their own
  full transcripts as usual. Set `THREADBOARD_DATA` to use another folder. A `~/.threadboard`
  folder from before the rename is moved to `~/.weft` the first time the app starts.

## Troubleshooting

If the page reloads over and over in development, stop the app, delete `.next`, and start it
again; a stale dev build cache causes this.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the feature list.

## Contributing and license

Issues and PRs are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
Weft is released under the [Apache License 2.0](LICENSE).

## Known gaps

- A card in a folder with no spare (or with a different CLI) still waits for its CLI to start the
  first time, unless it was opened or its project picked a little earlier.
- The copilot hears what finished or needs you only with your next message to it; it doesn't act
  on its own when a thread ends.
- puku-cli connects, but it was logged out during testing, so a full puku thread hasn't run yet.
  Run `puku-cli auth login` first.
- Only Claude Code sessions are picked up; puku-cli sessions (`~/.puku-cli/projects`) aren't yet.
- Picked-up cards open with the last 400 items of the conversation, and show the conversation as
  it was last read from disk, not live, until you reply in Weft.
- Automated tests are thin: `npm test` runs a Vitest suite over `lib/` (status parser, review tour,
  API guard, automations, formatting, settings, store, board tools) and over the API routes, with the
  runner and store mocked, and over the runner's SDK loop with a fake `query()`. UI tests have only started: the card, the reply box and the new-thread dialog (`components/*.test.tsx`, jsdom + Testing Library); the board and thread view have none. CI runs lint, typecheck and tests; a pre-commit hook type-checks what's staged.
- The terminal drawer runs in dev mode (`npm run desktop`) only: the packaged `.app` leaves
  `node_modules` out of the Electron bundle, so `node-pty` isn't there to load.
- No git worktree per card, on purpose: parallel cards in one repo share a working tree. Weft warns
  when they share a folder, but doesn't yet spot two threads editing the same files.
