# Weft

A board for your AI coding threads. Weft is a Trello-style board where each card is an AI CLI
thread (Claude Code or puku-cli), with a browser pane on the side that you and the agents can both
use, and a copilot in its own small window that can see and run the board.

In weaving, the weft is the thread that runs across the loom and binds the separate threads into
cloth.

## Run it

```bash
npm install
npm run desktop     # Electron app: board + side browser
npm run dev         # board only, in a normal browser at http://127.0.0.1:3456 (no browser pane)
```

The first `npm run desktop` downloads the Electron binary. Don't run `dev` and `desktop` at the
same time; Next.js allows one dev server per project folder.

## The desktop app

- **Closing the window keeps Weft running**, with your threads' CLIs open, so conversations stay
  alive. ⌘Q quits. Opening Weft again just brings the existing window forward.
- **⌃⌥Space** opens the copilot from any app. In the app: ⌘N new thread, ⌘J copilot, ⇧⌘B
  browser pane, ⌘F find cards, ⌘, settings, ⌘1 board, ⌘2 copilot.
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
  apps never write to one session.
- Deleting a picked-up card hides that session for good. Sessions in temporary folders (tests,
  tool runs) are skipped.

Weft's own threads run with a clean environment (no variables inherited from a Claude session it
was started from) and are marked as SDK sessions, so they don't show up in the Claude app's list.

## How cards move

| Column    | How a card gets there |
|-----------|-----------------------|
| Backlog   | You create it with "Add to backlog" |
| Running   | You drag it from Backlog, press "Start now", or reply in its thread |
| Needs you | The agent asks permission for a tool; Allow or Deny on the card |
| Review    | The turn finishes (or fails, or you stop it) |
| Done      | You drag it there |

Replying to a card continues the same CLI session, so the agent keeps its context.

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

## Projects, filter, and sort

The bar under the header lists your most recent project folders. Click one to see only its cards;
More lists every project, opens a folder, or creates a new one. Filter and sort controls sit on
the right. New threads default to the selected project.

## Logging in

When a thread fails because its CLI isn't logged in, the board runs `<cli> auth login` in the
background and pops up a login window with the login page link, the CLI's output, and a box for
pasting a code. If the CLI needs a real terminal, it opens Terminal with the login command instead.
Once `auth status` reports you're logged in, the thread runs again. Settings shows each CLI's
login status. The app also sends a desktop notification when a card needs you or finishes while
it isn't focused, and shows the Needs you count on the dock icon.

## Copilot

Press ⌘J (or the Copilot button) to open the copilot, an orchestrator thread in its own window.
It uses `mcp__board__*` tools to list cards, read threads, create cards, start them, reply to
them, move and stop them, and answer their permission requests. Reading and rearranging the board
happen without asking; starting a thread, replying to one, or answering for one asks you first in
the copilot window. "New chat" starts a fresh copilot session. In a normal browser tab the
copilot opens as a pop-up at `/copilot`.

## How it fits together

- `electron/main.cjs` starts the Next.js server, shows it in a window, and hosts the side browser
  as a native `WebContentsView`. Agents reach that pane through a token-protected control server on
  127.0.0.1; the board reaches it over IPC (`electron/preload.cjs`).
- `lib/runner.ts` runs each thread with the Claude Agent SDK (`query()` with streaming input, one
  CLI process per thread), streams messages to the board, and routes permission prompts to the card. For puku-cli it points the SDK at the
  `puku-cli` binary (`pathToClaudeCodeExecutable`).
- `lib/board-tools.ts` gives the copilot its board tools; `lib/copilot.ts` keeps its thread, which
  has the fixed id `copilot` and is left off the board.
- `lib/browser-tools.ts` gives every thread `mcp__browser__*` tools (open_url, read_page,
  screenshot, click, type_text) that drive the side pane. They're allowed without a prompt.
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

## Known gaps

- A card in a folder with no spare (or with a different CLI) still waits for its CLI to start the
  first time, unless it was opened or its project picked a little earlier.
- The copilot only acts when you ask it something; it isn't told when threads finish or need you.
- puku-cli connects, but it was logged out during testing, so a full puku thread hasn't run yet.
  Run `puku-cli auth login` first.
- Only Claude Code sessions are picked up; puku-cli sessions (`~/.puku-cli/projects`) aren't yet.
- Picked-up cards open with the last 400 items of the conversation, and show the conversation as
  it was last read from disk, not live, until you reply in Weft.
- There are no automated tests yet.
- No git worktree per card yet, so parallel cards in the same repo share a working tree.
- Assistant messages show as plain text, not rendered Markdown.
- One browser pane is shared by all cards.
