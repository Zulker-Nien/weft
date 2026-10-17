# Changelog

What changed in each Weft release. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/). Add a line under **Unreleased** when a feature
lands; a release moves those lines under its version and tags the commit `vX.Y.Z`.

0.3.0 is the first tagged release. 0.1.0 and 0.2.0 were never tagged: their sections below group the history by day.

## [Unreleased]

### Added

- **Weft asks before a thread leaves its project.** A file tool or Bash command that reaches a folder outside the card's project (say `~/Downloads`) now stops at a permission prompt with an **Outside project** chip, whether or not macOS would have refused it: **Allow once**, **This card** (its read scope) or **Always** (every card, `settings.allowedFolders`). Granted folders skip the CLI's own working-directory prompt for reads (`lib/folder-guard.ts`).
- **Threads can ask macOS for Downloads, Documents or Desktop.** A thread got "Operation not permitted" reading `~/Downloads` (say a new audio file to transcribe) because macOS blocks the folder until Weft is allowed. Now it calls `mcp__board__request_folder_access` (after such a refusal, or when you say to use files there; never on launch): macOS shows its own allow prompt the first time, and if the answer was already No a dialog explains it and **Open Settings** goes to Privacy & Security → Files and Folders (`electron/folder-access.cjs`, `lib/folder-access-tool.ts`). The packaged app carries `NSDownloadsFolderUsageDescription`.
- **A fresh coat of paint for the weft.zip dashboard.** The workspace pages (Team, Billing, the web board) get a sidebar with the workspace switcher, the current page lit, and your account at the foot (a top bar on a phone); raised surfaces, stat tiles and avatars on Team, a plan card, usage glow and price tiles on Billing; the Weft mark and a spinner on the /team, /app and invite cards; a lighter admin bar. Weft's own photography runs through it: the speeder crossing the dunes at the sidebar's foot, a road under each page's title (Coast Road on Team, Canyon on Billing) and the twin-suns scene behind the sign-in-style cards (`public/brand/scenes`, copies of the board's theme pictures). Team's banner is a generated render of a crew of mechanics in a garage with the speeder (`public/brand/scenes/garage.jpg`), and Billing's invoices are tickets with a stub, a status glow and a scan stripe. One self-contained stylesheet (`components/team/team.css`, root `.wz-app`), so a direct hit on /team or an invite link no longer depends on the home page's CSS having loaded.
- A new copilot chat suggests what to ask from everything Weft knows about your work (open cards in full, the uncommitted pile, quality and scout, streak, blanks, Vercel, Supabase, GitHub), most urgent first, above seven new starters ("Help me get started with Weft", …); the chips refresh in the background and wrap to fit the lane. Each chip is labeled with its project, so the chat shows only the selected project's chips (plus account-wide ones), and switching projects filters at once without a new run.
- The copilot onboards you: it knows what isn't linked yet (Weft account, GitHub CLI, Vercel, Supabase, Cloudflare, analytics), offers the one link that helps, and points you at the right drawer.
- **License: FSL-1.1-ALv2.** Weft moves from Apache-2.0 to the Functional Source License: fork, change, self-host and use it at work, but don't ship it as a competing product or service. Each release becomes Apache-2.0 two years after it ships; v0.3.0 and earlier stay Apache-2.0. New `TRADEMARKS.md`: forks you share need their own name and icon.
- **Terms of Service at weft.zip/terms.** What the online services cover (accounts, workspaces, sync, the relay, plans), fair use (no scraping, no unofficial clients or forks calling Weft's servers, no cheating for streaks or stretching free limits), and that your content stays yours. Linked from the home page footer.

- **Readable edit prompts.** A held Edit or Write (the symbol-claim "Wait, or go ahead?" or any other permission prompt) shows who asks, the file, the function it changes, +added −removed and a short diff with real line breaks, instead of escaped JSON, and says why it asked as a category (Same code, Overlapping code, Whole file, or Permission mode) with the card holding the code. When another card holds the code, **Wait** comes first: the edit stays held until that card finishes or commits, then the thread re-reads the file and redoes the edit on top. **Raw** still shows the JSON (`lib/edit-preview.ts`, `components/PermissionInput.tsx`).

- **Dropped-import guard.** An edit that removes an import the file still uses (the board's "columnMinWidth is not defined") is reported to the thread right away (`lib/dropped-imports.ts`). The `.claude/settings.json` guards now also run for a `puku-cli -p` or `claude -p` a thread starts, which used to skip them (`lib/weft-thread.ts`).

- **New thread on the weft.zip board.** Pick one of your synced folders, write a prompt and your Mac makes the card and runs it, then the board opens it. The request is a `cloud_commands` row the Mac claims over Realtime (and a 30 s check); it only obeys your own account's requests for a folder switched on in Settings → Sync, and uses its own permission setting. `POST /api/cards` and the inbox now share `lib/new-card.ts`.
- Settings → Models → **Review all** picks the Claude model the Review column's "Review all" card runs on (default: the CLI's own).
- Pasted and dropped PNG, JPEG and GIF chat attachments are converted to WebP on upload to reduce disk and prompt image size. Tool screenshots and the pane thumbnail after each turn are saved as WebP too, and images Weft picks up from a session it reads (pasted into Claude Code, or shown with `![...](path)`) get a WebP beside them that later reads use.
- Codex and Puku threads match Claude Code outside Weft's own folder. Codex gets Weft's browser, board, secrets, webhook and board-view tools (a per-turn token and `/api/mcp/[server]`, shown in the thread as `mcp__server__tool`), the project's `CLAUDE.md` (Codex loads `AGENTS.md` only, and DeckCP keeps its instructions in `CLAUDE.md`), and both Codex and Puku get the folder's and your `.claude/skills` as an index plus `/name` expanded to the skill. Puku's project instructions also stop cutting at 60,000 characters (now 100,000), so DeckCP's 66 KB `CLAUDE.md` arrives whole.
- Super-admin pages on the left rail: a 🛡 **Admin** icon (visible only to addresses on `SUPER_ADMIN_EMAILS`) opens `/admin/users`, a paginated, searchable list of every weft.zip account, with a companion `/admin/settings` page that shows the local install's data dir, version, uptime, card and thread counts, activity log size and keep-alive setting. Built on `@aimhuge/admin`'s `AdminTablePage`, gated by `@aimhuge/teams`'s `isSuperAdmin` via `lib/admin.ts`; the check is server-side and the routes 404 for non-admins.
- Server-side cards, off by default: Settings → Sync turns on a project, and its cards and threads upload to your workspace on
  Supabase (pictures and pages once each by content); the page shows the last sync, items uploaded, how many wait and the last
  error, with Sync now (docs/architecture/cloud-sync.md).
- The web board: `weft.zip/<workspace>/board` shows the synced cards in their columns, live, and opens a card's thread (read-only). It draws the desktop's own `CardView` (read-only), column headers, project chips, filter box, sort and archived toggle, and a card's thread through `ThreadEntries` and `Markdown` (oldest first, tool runs folded to "Ran 3 commands", tables and code blocks, pictures through signed links, a trimmed tool output loading from `cloud_tool_outputs` when its row opens), so the two boards stay in step.
- Threads load their newest 50 items first and older ones as you scroll up; a tool's output over 2 KB loads when you open its row.
- Settings → Models has a Copilot row: pick which Claude model the copilot thread runs on. The copilot is locked to Claude Code, so only Claude models appear; the default follows the model you last picked for new threads. The pick is read once when the copilot card is first made, so it takes effect on the next "New chat" in the copilot lane.
- A new tagline, "Engineering the future, one thread at a time": on weft.zip's hero (under an "Agentic engineering, on your Mac" eyebrow), its title and social card, the start screen, About and the README. Under the screenshot, five pillars: code review, the copilot, social, connectors and the vault.

### Fixed

- The copilot's **New chat** clears the conversation every time. The thread view kept its own copy of the old messages and only redrew after a remount, so the old chat often stayed up and the next reply landed on top of it. Clearing a thread now tells every open view (`thread_cleared`), and the button reads "Starting…" while the old CLI winds down, so a slow reset no longer invites five more clicks.
- The board no longer gets stuck on its gray placeholder cards right after launch. Some launches sent Next's dev server into a loop where each request for the board applied a server update that counted as a change, so the board refetched and remounted a couple of times a second until Weft restarted. Turbopack's server Fast Refresh is off now (`next.config.ts`); a server file edit still reaches the board on its next request.
- A Review card no longer opens the browser pane on a dead port like `127.0.0.1:4567`. When a tour left out its `url`, Weft guessed the app from every local address in the thread, tool output included, so a grep over Weft's own tests (which use a fake `127.0.0.1:4567`) won. Now the guess counts only the thread's replies and the pages it opened, and it doesn't run when every step already names its own page (`lib/review-tour.ts`).
- The board, home page and social preview use locally hosted fonts, so production builds no longer wait on Google Fonts requests;
  the home page's GitHub release-feed lookup now times out after three seconds.
- A review step that points at a local page with an anchor or query (`tour.html#built`) now opens that section;
  the `#` used to be encoded into the filename and the pane showed nothing.
- The Supabase drawer counted a migration applied through the MCP (which stamps its own version) as not applied; it
  now matches by name too and says how many sit under another version.
- The Puku trial proxy on the deployed Weft used to forward both `x-api-key` and `Authorization: Bearer` upstream;
  `api-cli.puku.sh` answers `multiple_credentials` when it gets both, so the proxy now forwards only `x-api-key`
  (`lib/puku-proxy.ts`). Inbound still accepts either header from puku-cli.

### Changed

- **Smaller files.** 21 of the 26 files over 300 lines were split into focused modules, behavior unchanged (`Board.tsx` 1,078 → 849, `Composer.tsx` 614 → 281, `lib/import.ts`, `lib/types.ts`, `lib/secret-guard.ts`, `lib/client.ts` now re-export from `lib/import-*`, `lib/types-*`, `lib/secret-guard-*`, `lib/client-*`); Settings pages are one file each (`components/Settings*Page.tsx`). The quality checker no longer counts paths in a `Status: design` doc as stale.

- The copilot is a lane on the right of the board instead of a card: minimized it's a column with what finished, what needs you, its latest reply and an ask box; open (⌘J or the ✨ button) it's the chat over a cockpit picture, the copilot in a flight helmet in the seat beside you, while the five columns narrow to stay in view.
- The copilot's lane has three states now (Intercom-style hider): the default is a 36px pill pinned to the right edge (avatar, needs-you dot, news count, vertical "Copilot" label) so it doesn't eat board width; ⌘J cycles it to a 236px peek (the digest column) and then to the 520px chat. The peek auto-closes 6s after the mouse leaves; the columns keep their 170px floor when hidden, 120px when peek or open.

- Settings → Team looks like the rest of Settings (one card per section, a role pill and member count, email, role and Send invite on one line) and opens already loaded: the team is fetched as soon as you sign in. Invites default to Member instead of Owner, and the roster says "Owner", not "owner".

- A thread's questions are asked the Claude Code way: numbered options with ↑/↓, number keys and Enter, checkboxes for multi-select, a tab per question plus a Submit tab (text typed there goes with the answers as a note on all of them; no separate Chat about this). The reply box is the only input (your own answer, or a note on your pick, sent to the CLI as annotations), text already in it carries over, and option previews show in the browser pane.

- Cards take turns at `pnpm typecheck` and `pnpm lint` (and the pre-commit hook's tsc) instead of all checking the whole repo at once, and a new Bash guard sends a direct `npx tsc` or `eslint` through them; tsc and ESLint also skip leftover installs like `node_modules.npm-old`, cutting tsc's file count by 79%.

- New thread: while Weft makes the thread, Start reads "Starting…" with a spinner (Add to backlog reads "Adding…"), and both buttons dim clearly, instead of just going quietly unclickable.
- Weft now builds with pnpm (hoisted node_modules); run `pnpm install` instead of `npm install`.

### Added

- **Migrate** in the Supabase drawer: starts a card that reviews the pending migrations, applies them on your OK and
  renames local files to the versions Supabase recorded.

- A glance rail beside the browser pane's page: one small card per turn of the open thread (a status dot, its first words, how long ago) and per page the pane showed, newest at the bottom like the chat. Each message you send remembers the page on screen then. Click one to scroll the chat to that turn and put the pane back on the page it showed then; scroll the chat and the turn at its top lights up. It hides in windows narrower than 980 px.
- **Codex CLI backend**: choose Codex for a new thread, resume its saved session between turns, set its sandbox mode and reasoning effort, switch cards between Claude Code, puku-cli and Codex, and check its login status. Codex uses its own CLI tools; Weft's browser, board, secrets and webhook MCP tools and per-tool guards aren't available in Codex threads.
- **Shortcuts discoverability**: Settings → Shortcuts now lists every shortcut in the app, grouped by
  what they do, in addition to the rebindable dictation row; users landing here for help see the full
  set without having to learn the `?` key first.
- Weft teams on weft.zip: every account gets a workspace; owners and admins invite people by email, change roles and remove
  members at `/<workspace>/team`, and **Your team** in the account menu opens it in the pane (docs/architecture/teams.md).
- Weft Pro: workspace billing on weft.zip (Stripe Checkout and portal), with a monthly Puku allowance in place of the daily
  trial cap; Settings → Accounts shows your plan and usage.
- weft.zip sign-in has its own cookie session (`/auth/sign-in`, `/auth/callback`, `/auth/sign-out`), so each visitor is their own account.
- ▲ Vercel drawer: **Push all** sends every 🔐 vault value to the linked project, in every environment, behind one Touch ID.
- `mcp__secrets__set_value`: a thread stores a secret it generated (a signing secret) into one of its 🔐 blanks after Touch ID,
  blanks only, value never echoed (`electron/vault-routes.cjs`, `POST /secrets/set`; docs/architecture/secrets.md).
- Vercel drawer: pull plain env variables the 🔐 vault has no value for (never replacing one), and **Live pull from Vercel**,
  a team webhook relayed by the deployed Weft and Supabase that pulls them as they're added (`lib/vercel-hooks.ts`,
  `lib/vercel-relay.ts`; docs/architecture/vercel.md).
- **Cloudflare setup token**: the Cloudflare drawer asks for a setup token ("Create additional tokens" template); Weft
  makes its own narrower token with it (account settings, Workers, Pages), keeps that in the Keychain and deletes the
  setup token. The token form is bigger, with numbered steps. A token you made yourself still works as before.
- **Settings, reorganized**: Settings fills the window over one of Weft's scenes (yours, if you picked one), with six pages
  down the left (General, Models, Threads, Automations, Shortcuts, Accounts) as frosted cards and no tabs. Models holds
  every model pick: new threads' CLI, model and effort, subagents, and the Done wrap-up. A dot marks a page with edits waiting for Save.
- **Last opened card**: the card you opened last keeps a neutral ink outline after you close it, so you can find your
  place; unseen cards keep the accent border, tint and dot.
- **Model on the card**: a card's footer names the model its thread runs on ("Opus 5.5") beside the CLI dot, in the
  CLI's colour; hover it for the full id and effort.
- **Login page redesign**: `/login` on weft.zip is two panels: Weft's twin-suns speeder with "Pick up the thread."
  over the sky on the left, and on the right the cockpit picture (the copilot's pilot) with the sign-in as a glass
  card over the dash and a cream **Continue with GitHub** button. It stacks on a phone. Replaces the slide-editor
  framing (crop handles, coordinates).
- **Sign in on weft.zip**: the deployed site has a real `/login` page (`app/login/page.tsx`) with
  **Continue with GitHub** (no Google, no magic link on the new page). The board's top-bar sign-in,
  Settings → Weft account, and the Puku-trial upgrade prompt keep the same flow. A new
  `app/api/auth/callback` GET route (and `/api/auth/weft-callback` POST) replace the old
  `app/api/account/*` JSON surface; the in-app hook is `useAuth` from a thin `lib/auth/` wrapper
  whose public API mirrors `@aimhuge/auth`, so swapping to the package upstream is one line.
  `safeNextPath` rejects open-redirect tricks on `?next=`. Home page has a **Sign in** link in the nav
  when signed out, hidden when signed in. The deployed post-sign-in landing is a small "you're in"
  card at `/app` (`app/app/page.tsx`) with the desktop download CTA.
- **Restart when idle**: Weft → Restart When Idle, the command palette or a thread's `mcp__board__restart_weft_when_idle`
  stops new turns from starting and restarts Weft once the running ones end. Messages sent meanwhile wait on their card
  and go out after the restart; the header's **⟳ Restart after N** names what it waits on and cancels on click. The
  updater's "threads are still running" question offers it too, as **Restart When Idle**.
- **Failed loads say why**: when a page in the browser pane fails to load (a dev server that isn't running, a bad
  address, no network), the pane shows Weft's own error page (`electron/pane-error.html`) in place of Chromium's
  blank white one. It names the URL and the reason, offers **Try again** and **Back to the last page**, and for a
  local dev server reloads by itself once the server answers. The toolbar keeps the failed URL, and the error page is
  never saved as the card's page.

### Changed

- The Running and Needs you columns show **Switch all** only once a thread hit its plan limit (`hitPlanLimit` in `lib/board-view.ts`).

### Fixed

- **Editing one of Weft's prompts reaches idle threads**: the build fingerprint hashed the runner's source but not the text of the prompts it appends, so after an edit to `BROWSER_PROMPT`, `SECRETS_PROMPT` and the like an idle session kept the old prompt until it ended. Every pinned prompt now lives in one list (`WEFT_PINNED_PROMPTS`, `weftSystemPrompt()` in `lib/weft-prompts.ts`) whose content is part of `currentBuild()`, and a new first line names SOUL.md and AGENTS.md as the source of truth for Weft's identity and conventions.

- **A message after an early Stop continues the conversation**: a card only learned its session id from the CLI's init, which puku can take 15s or more to send, so a thread stopped before then lost it and "continue" started a new conversation ("I don't have prior context"). Weft now picks a new conversation's id itself (`--session-id`) and keeps it on the card from the first message (`lib/runner-session.ts` open, `lib/runner.ts`); Claude Code cards had the same gap.

- **Puku threads know where they are in any project**: Puku's gateway drops the system prompt a client sends, and puku-cli reads only PUKU.md, so a puku card outside Weft's folder started without its working directory, the project's CLAUDE.md/AGENTS.md, or Weft's thread prompt (no BOARD STATUS, pane or vault). Each puku CLI's first message now carries all three in a `<system-reminder>` (`lib/puku-context.ts`, docs/bug-fixes/015).
- **`/weft:done` no longer leaves scratch files in the project**: each wrap-up's prompts, `tasks.json` and batch
  output go to its own `~/.weft/done/run-XXXXXX/` (`plugin/skills/done/scratch.sh`), removed at the end and pruned
  after a day, so they stay out of the commit pile and wrap-ups running at once can't overwrite each other's notes.
  The old in-repo paths (`.done-batch/`, `.scratch/`, `plugin/skills/done/{out,scratch}/`…) are gitignored.
- **Puku login dialog no longer pops again after a successful browser sign-in**: a recent puku-cli update made
  the credential visible to `auth status` only after the `auth login` child had already closed, so Weft's single
  immediate re-check ran too early. `lib/login.ts` `onExit` now polls `auth status` every 3 s for up to 10 s
  before declaring the login failed, so the dialog closes the moment the CLI sees the new credential and the
  waiting card retries.
- **No more "This thread is already running"**: a message that reaches a busy thread from its page (Tell me what
  to change, a failed commit's note) waits on the card as "after this turn" in the reply queue and goes as the turn
  ends. "Commit and run /done" on a busy card runs /done once its turn is over instead of failing.

- A card switched to puku-cli no longer keeps its Claude model ("Fable 5.1" on puku, which the gateway quietly ran as
  puku-ai-2.8): it moves to puku's default, and the thread header's model chip now lists each CLI's models to pick from.
- "Review all" on the Review column opens the walk-through card it starts, instead of leaving it to land unseen
  among the other Review cards.
- Idle puku threads no longer burn CPU. puku-cli ran a forced, full Node garbage collection every second (a
  `setInterval(gc, 1000)` it took from Claude Code, where it's Bun's cheap hint), so each idle puku CLI used 8-15%
  and ten pegged the Mac. Weft now starts puku-cli with `PUKU_CLI_DISABLE_HEAP_RELAUNCH=1`, which leaves `gc`
  unexposed (idle: 0.1%) and runs puku as one process instead of a wrapper plus `Puku`. Puku is also held tighter:
  2 idle puku CLIs at most, closed after 10 idle minutes, and one puku spare that isn't refilled after a card
  takes it (`lib/puku-idle.ts`).
- Ending a puku thread ends its `Puku` process too. puku-cli's `node` wrapper left its `Puku` child running under
  PID 1 at 10-30% CPU after every idle close, stop or server restart. Each thread CLI now starts in a process group
  of its own that ends as a whole (`lib/cli-process.ts`); the server takes every CLI with it when it exits, and on
  start it ends the orphaned ones an earlier server left in Weft's project folders (`lib/cli-reaper.ts`). A puku you
  run in a terminal is never touched.
- The board stays on one port again: it now prefers 127.0.0.1:1024. The old 1000 is a privileged port macOS won't
  let Weft bind, so every launch fell back to a random port and cards' panes, dev OAuth redirects and saved pages
  pointed at a dead one.
- The email forwarder drops mail to `dmarc@`, `postmaster@` and `abuse@` (and their sub-addresses) instead of
  forwarding them: a 200 with the reason in Vercel logs, so Resend doesn't retry and your inbox stays clean
  (`shouldDrop` in `lib/email-forward.ts`).
- The "Run a command with secrets?" approval names the card asking and shows the thread's reason, so you know
  which thread wants a secret and why before you allow it.
- At most 8 idle card CLIs stay open; past that the least recently used close and resume on your next message, so
  a long day no longer leaves dozens of CLIs (and their MCP servers) slowing the Mac and the board.
- A pasted file whose bytes are sent shows "Saving…", and fails after a minute without a reply instead of
  spinning at "Uploading 100%" forever.

### Added
- **Blanks are the default for missing secrets.** A thread that needs a key it doesn't have puts the name in
  the vault as a blank right away with `mcp__secrets__add_blank` (with a hint for where to get the value),
  keeps going, and the user fills the blanks in from 🔐 on the rail when they're ready. The rail's badge
  counts them, blanks sort first within each environment, every blank row has a visible **Fill in** button
  and the hint under the name, the right-click menu's **Set Value…** becomes **Fill In Value…**, and the
  plain Add form's button reads **Add blank / Add N blanks** until a value is typed. `mcp__secrets__ask_add`
  stays as the urgent path (an input for the key in the thread). `lib/secret-ask.ts` `ASK_PROMPT` is the
  new default, `electron/vault.cjs` `addBlanks` stores the hint and source, `lib/vault-view.ts` `saveLabel` /
  `blankTitle` / blank-first sort name the UI, `components/SecretRow.tsx` and `components/VaultParts.tsx`
  draw it. Older shells without `addBlank` keep the "type a value" form.
- **Review all** at the top of the Review column starts the same commit walk-through card as the header's "+N/-N" counter (`lib/pile-review.ts`).
- Supabase drawer: each unapplied migration's name opens the card that wrote it (`migrationOwner` in `lib/supabase-view.ts`).
- Email at weft.zip: Resend receives every mail to the domain and the deployed Weft forwards it to one inbox (`app/api/email/webhook`,
  `lib/email-forward.ts`; `npm run resend` sets up the Resend side through the vault; docs/architecture/email-forwarding.md).
- Home page for weft.zip: the deployed Weft (Vercel) renders a landing page at `/` instead of the board (`components/home/`,
  `lib/home.ts`; `/home` on a local Weft). One screen: the steel weave emblem, the headline and one sentence over the twin suns
  scene, a download button that reads the latest release feed (`lib/home-release.ts`) and a real screenshot of the board
  (`public/brand/board.png`).
  `app/opengraph-image.tsx` draws the shared-link picture on the twin suns scene.
- The thread header's CLI chip names the model and effort the thread runs on ("Opus 5.5 · xhigh"), from its CLI's
  init, with your Claude Code `effortLevel` when the card picked none; hover it for the full id.
- Puku trial: puku threads work with no Puku account. Signed in to your Weft account, a puku-cli with no login of
  its own runs on Weft's Puku key through the deployed Weft (`/api/puku/v1`, a streaming pass-through that checks a
  signed day-long token, meters each account per day and answers 429 over 300 requests or 2M tokens); the key never
  ships in the app. Signed out, Puku's login pop-up offers **Sign in to Weft**, and signing in runs the waiting
  threads again (docs/architecture/puku-trial.md).
- Weft.app ships its own toolchain, so a fresh Mac with no Node can build Next.js + Supabase projects: `node`, `npm`,
  `npx`, `pnpm`, `pnpx`, `puku-cli` and `claude` in `Resources/toolchain/bin`, all on Weft's own Electron as Node and
  appended to the end of PATH, so a Mac's own tools still win. puku-cli ships without its OpenTelemetry and Sentry
  telemetry (426 → 196 MB) (`scripts/bundle-toolchain.mjs`).
- Subagents: every thread's prompt says when to hand work to a subagent (broad searches, independent pieces in
  parallel, test and lint runs, second-opinion reviews), and Settings → Use for subagents picks their model: let
  the model choose (the default, with a short Haiku / Sonnet / Opus guide), the thread's own, or any Claude or Puku
  model; a model from the other CLI runs that CLI headless (`puku-cli -p` / `claude -p`) as the subagent. Changing it, or the thread prompt, now replaces idle CLIs so their next message uses it.
- Symbol claims: a card claims the top-level function, component, class or type its thread edits (found with the
  TypeScript parser; inside one over 150 lines, the statement holding the edit, like `Board/useEffect#3`), and when another busy card in the same folder goes to edit it, the thread asks: "Card ‘Fix
  login’ is editing LoginForm in Login.tsx. Wait, or go ahead?" Claims drop at Done, on archive and on commit.
- Vault → Vercel env push: the ▲ drawer lines each linked project's 🔐 secrets up with its Vercel variables per
  environment and pushes one with **Push** (sensitive, Touch ID per push); threads can do it with
  `mcp__secrets__push_to_vercel`.
- A thread blocked on a key the 🔐 vault doesn't hold (`mcp__secrets__ask_add`) shows an input for it right in the
  thread, name filled in: paste the value, **Add to vault**, and the thread is told it's in. The value never reaches it.
- GitHub on the left rail: its mark opens a drawer with the `gh` CLI's sign-in (or how to sign in) and, per project, its
  repo, an **Issues → Backlog cards** switch, the last sync and **Sync now**.
- Instant GitHub issue sync: **Instant, by webhook** in the GitHub drawer adds a repo webhook relayed by the deployed
  Weft on Vercel (it checks GitHub's signature) and Weft's Supabase (Realtime), so cards follow issues within seconds.
- Cloudflare on the left rail: its cloud under Supabase's bolt opens a drawer that links a project to a Worker or Pages
  project (token kept in the Keychain, best fit from the folder's wrangler config), with its address, latest deploy and
  dashboard links.
- The Supabase drawer makes projects: **+ New project** in Link… names it after the repo, asks the org (with more than one)
  and region (where most of your projects are), creates it through the Management API and links the folder. Weft makes
  the database password and keeps it in the folder's 🔐 vault as `SUPABASE_DB_PASSWORD`, never shown.
- BlastCP's property picker can make a new property: **+ New property** names it after your search or the project, asks
  which workspace when you have more than one, creates it on BlastCP (with its starter voice and playbooks) and links the project.
- Your loom: the builder card is now your wefter card, "Wefter: name · class", with your GitHub profile (picture, @login,
  bio, location, company, site, followers, repos) from `gh api user`; the streak reads "Wefting streak, N days straight".
- `!` in a reply box runs a shell command in the card's folder (`lib/shell.ts`), like Claude Code's bash mode: the box
  turns amber, the thread shows the command and its output, and the output goes to Claude with your next message.
  Two-minute limit, keys in the output masked, and commands the secret guard refuses (`cat .env`) don't run.
- Push on Done: `/weft:done` pushes the branch after a clean commit (`plugin/skills/done/push.sh`), so moving a card to Done
  ships it. On by default; turn it off in Settings. A plain `git push`, never forced: a rejected push leaves the card in Review.
- Board view: threads can screenshot, click, hover, type into and read Weft's own board window (`mcp__board_view__*`), so a
  change to a drawer, dialog or card gets checked in the real app; a fixed set of operations, no arbitrary JS, and revealed
  secret values read as ‹secret› and are blanked in screenshots.
- Secrets: the Composer flags a key you type, dictate or drop in, not just one you paste (Remove it / Keep it);
  threads no longer get secret-named or key-shaped variables from your shell's env; the pre-commit hook scans
  for keys even without gitleaks; and the control server's token moved from the server's env to a 0600 file.
- ↑ in an empty reply box edits your last message (after any queued one). Enter stops a running turn, rewinds the
  conversation to before that message, folds the old message and its reply into an "Edited" line you can open, and
  sends the new text; Esc cancels. Files the replaced turn changed stay as they are. Claude board threads only:
  picked-up sessions and puku-cli send the edit as a new message.
- A Backlog counter (☰ 7) beside the uncommitted counter. Click it to start a card that reads every Backlog card
  against the code and plans them into sprints of cards that can run side by side, on a page with Start this sprint,
  Move, Merge, Split and Archive buttons; it starts nothing until you say so.
- ★ star and tags replace the library. ☆ on a card or thread header (or K in its menu) stars it, a starred card is
  never auto-archived, and the rail's ★ shows only starred cards. Tags follow GitHub's label rules and show as up to
  two pills on a card's stage line; click one to filter the board. Library cards became starred cards tagged
  `recipe`, `to-do` or `note`.
- The 🏷 tags drawer (⌘L), like GitHub's labels page: new tag with a colour, rename, recolour, delete, click to
  filter, drop a card to tag it. **Tags…** in the card menu (G), or a click on the thread header's tags, edits a
  card's tags with autocomplete.
- Auto tags: the Haiku call that names a card after its turn also gives an untagged card 1 to 3 tags, reusing the
  board's own; tags you set are never changed. The copilot can set tags too.
- GitHub issues become Backlog cards: ⌘K → "Import GitHub issues into <project>" reads its open issues through `gh`,
  labels as tags and "#N" on the card, and checks again every 5 minutes. A closed issue archives its card if it
  never started.
- A build error mid-edit (a stray `}` in Board.tsx) no longer covers the board with Next's Build Error overlay: the board
  keeps running the last version that built, and a small bar names the broken file until it is fixed.
- The `?` keyboard shortcuts sheet is bigger and easier to read: up to 1100px wide, larger text and key caps, accent
  section headings, and each shortcut's fine print (in brackets or after a colon) on a dim second line.
- Shift+`S` adds a secret: it opens the 🔐 drawer on its Add form, and "Add a secret" in the ⌘K palette and the `?` sheet does the same.
- Threads can run a command with 🔐 vault secrets they never see: `mcp__secrets__run` asks you (the exact command, its
  `package.json` script, the names; Allow once or Always allow, then Touch ID), runs it from Electron main with the
  values in its env only, and returns the exit code and output with each value as `‹NAME›`. A card's dev server gets
  the vault's development values the same way, and a secrets-using card's stored tool results are redacted.
- ▲ on the left rail links a project to Vercel: paste a token once (kept in the Keychain), pick one of your Vercel
  projects or make a new one with its GitHub repo connected, and see its production URL and latest deploy. The link is
  `.vercel/project.json`, so the Vercel CLI in threads works on the right project.
- Supabase's bolt on the left rail links a project to Supabase: paste an access token once (kept in the Keychain),
  pick one of your projects, and see its state, region, API URL and which local migrations it hasn't applied, with
  Restore for a paused project and links to its auth users, logs, keys, usage and dashboard. The link is
  `supabase/.temp/project-ref`, so the Supabase CLI in threads works on the right project.
- A linked Vercel project's card links straight to the latest deploy's page, runtime logs, env vars, domains and the
  dashboard; personal projects (no team) now link to their own dashboard too.
- The code quality badge scores Documentation too: a README, an agent guide, architecture docs, a CHANGELOG, source
  files that open with a comment saying what they're for, and no file paths in the docs that no longer exist.
- The copilot shows as a card at the top of its column (✨ whole board), so you can see when it's running or needs you;
  click it to open it in the same window as any card (with its own browser pane and New chat), as does the top bar's ✨ Copilot button; Allow, Deny and Stop work right on the card.
- The New thread page cycles through the speeder and the five backdrop scenes, a new one each time you open it.
- Placeholder cards pulse in every column while the board loads, instead of empty columns and "0" counts.
- ▶ on every idle card with a session sends "continue" into its thread, for a model that gave up too early; a card you
  stopped or whose turn failed also gets **Restart**, which runs your last message again in a fresh CLI.
- **▶ Resume N** at the top of Review carries on every turn there that a restart cut off or that failed. A turn cut off
  again during its carry-on now resumes again too, up to three times in a row (it used to stay stopped after one).
- BlastCP on the left rail, under its rocket logo: connect your BlastCP account in the browser (kept in the Keychain), link each project to
  the property it posts as, and see its next scheduled posts, drafts, posts to approve and failures; click one to
  open it in the browser pane.
- Many more error boundaries: one message, dialog, drawer or header badge that fails to draw shows a "failed to draw ·
  Try again" in its own spot (a small chip for badges and messages), and the reply box, dialog ✕ and the rest stay working.
  The board's panels, dialogs, cards and badges load in their own boundary too, so a file a thread left half-written
  (even one that fails as it loads) no longer blanks the whole board; a broken dialog offers Close, and the board's
  own error page hides the browser pane so it isn't covered.
- An archive button in the Done column header files away every Done card it shows (same as Shift+E), with Undo.
- Threads fill secrets in themselves: `mcp__secrets__list` gives a vault's names and `mcp__secrets__fill_field` types a
  value into a field in the browser pane after your Touch ID (naming the secret, vault and site), masked on screen and
  shown to the thread as `‹NAME›`. The thread never sees the value; https pages only.
- Scene themes: six of Weft's own pictures (Twin Suns, Canyon, Coast Road, Neon City, Snow Pass, Salt Flats) as
  board backgrounds, each with its own palette, from Settings → Appearance or ⌘K.
- Plan first: on a long task, a thread writes its plan to the browser pane in one of its first tool calls and ticks
  the steps off as it builds, so you can watch the plan instead of a blank pane.
- Resume after restart: a card that was running when Weft quit carries its turn on after the restart, instead of
  sitting in Review as "Stopped when the app closed".
- Board skeleton: while the card list loads on launch, each column shows pulsing placeholder cards instead of
  sitting empty with "0" counts.
- Commit walk-through: Commit, Commit and push and Commit and run /done run on their own with no LLM turn
  (`weft://commit`): they commit exactly the change's files, push, move its card to Done and stamp the page;
  only a failure (say, the pre-commit hook refusing) asks the thread for help.
- Weft account: Sign in with GitHub from the top bar (right of Copilot), or with GitHub, Google or an email link in
  Settings → Weft account, against the Weft prod Supabase project. Signed in, the button is your avatar.
- Import guard: after each Edit or Write, a board thread (and its subagents) hears about any import the edit broke,
  so a half-finished change can't leave the board on a build error.
- New thread: ⌃↵ starts the thread and keeps the dialog open for the next one; holding ⌘ or ⌃ relabels the Start button.
- New project… in the New thread folder picker: name a folder, Enter creates it in ~/dev and starts the thread there.
- ⌘K opens on "Recently changed": the cards that moved column in the last day, latest first.
- ⌘K is wider with larger text, and each card row shows its last line of output (or its error) and how long ago it changed.
- Auto-updates: the packaged app checks GitHub Releases, downloads in the background and offers Restart to Update;
  Weft → Check for Updates… checks now. An unsigned build offers the download instead.
- Secrets vault: 🔐 on the left rail keeps each project's secrets encrypted on this Mac, imports `.env` files
  with a preview, nudges when `.env.local` has values to import, and asks for Touch ID to reveal or copy one.
- Vault: after an import Weft can write `.env.local` from the vault (gitignored, mode 0600, `# Managed by Weft`) and keep
  it in step; edit it by hand and the drawer offers to import your change.

- ⇧S (or "Add a secret" in ⌘K) opens the 🔐 drawer with its Add form ready on the top bar's project.
- Vault: add or change a secret by hand in any project, even one with no `.env` file; copy a secret to another
  project from its right-click menu; and a project filter that follows the top bar until you pick another.
- Releases: a `vX.Y.Z` tag builds, signs, notarizes and publishes the dmg and zip, with this changelog as the notes.
- Commits from a board thread are co-authored by "Claude Opus 5.5 on Weft" (whichever model the card runs), and PRs
  say "Generated with Claude Code on Weft".

### Security
- The Weft account's refresh token is sealed in the Keychain by Electron main instead of a plain `~/.weft/account.json`.

### Changed
- Auto is now the fallback permission mode everywhere: cards a thread starts with no parent card, and a new copilot,
  follow Settings → Default mode instead of `default`.
- The ▲ Vercel, Supabase and BlastCP drawers open on their last status (kept in memory and localStorage across
  restarts) instead of "Asking Vercel…", refresh it quietly behind, and ask the service at most every 30s on
  focus. The three hooks share `lib/use-linked-status.ts`.
- The Weft account sign-in's OAuth redirect target is now `weft://account-callback`, so the URL is stable across
  Weft restarts (the dev server picks a fresh port every launch); plain `next dev` still uses the loopback HTTP
  origin. Electron main's `weft://` handler forwards the code to a new `/api/account/weft-callback` route, which
  exchanges it against the PKCE verifier kept in the session file. In `npm run desktop` (dev Electron), a wrapper
  `Weft Dev.app` at `~/Applications/Weft Dev.app` is built by `scripts/dev-protocol.cjs` to declare the scheme in
  its Info.plist (the dev Electron.app can't), registered with LaunchServices, and forwards the link to the running
  dev Electron via a `--weft-link=weft://…` argv (parsed by `electron/argv-link.cjs`).
- Over a scene, columns are clear instead of frosted: the picture shows between the cards, with a faint edge
  keeping each column's shape.
- A card running `/done` or `/weft:done` (typed, or from a move to Done) sits in Done while it runs, still
  spinning, and is archived when it finishes; before, it jumped back to Running until the end.
- Builder card: Craft now counts the habits your shipped cards' transcripts show: wrapping up with `/done`,
  committing, code review, docs and refactor skills, as well as refactor titles.

### Removed
- Builder card: the Thrift attribute (cost per shipped card) is gone; seven attributes remain.
- The reply box's "Also running here: …" line: in a busy repo it always showed. The card's "+N here" chip and
  the New thread dialog's line stay; symbol claims (on the roadmap) will warn at the moment two cards clash.

### Fixed
- An edit that makes a route file (`app/**/page.tsx`, a layout, a `route.ts`, middleware) import a module that isn't
  there yet is now refused before it lands, with the file to write first: one such import took the board and every
  `/api` route down for ~5 minutes (`lib/route-import-guard.ts`, docs/bug-fixes/010).
- A parse error in `components/home/Home.tsx` no longer 500s the board. The home is now loaded through
  `loadHome()` in `lib/home.ts` (a cached dynamic import) from both `app/page.tsx` and `app/home/page.tsx`, so
  `app/page.tsx` no longer static-imports a module it doesn't render in dev; `/home` shows a small fallback when
  the home fails to load (`docs/bug-fixes/011`).
- The packaged app no longer crashes at launch with "Cannot find module 'libsodium-wrappers'": the Electron bundle now
  carries the main process's two packages, `libsodium-wrappers` (the 🔐 vault) and `node-pty` (the terminal drawer).
- Threads, a card's dev server and `!` commands no longer inherit Weft's own `next dev` env (`NODE_ENV=development`,
  `PORT`, `__NEXT_*`, `NEXT_PRIVATE_*`, `NEXT_PUBLIC_*`, `TURBOPACK*`), so `next build` in another project prerenders
  again instead of failing on `/_global-error` (`lib/env.ts`).
- The "Couldn't sign in to Weft" dialog shows plain text (it showed `Couldn&#39;t`) and no longer repeats its title in
  the message (`electron/account-link.cjs`).
- A card waiting on you (a question with Answer, or Allow/Deny) can be dragged to Backlog, Review or Done to park
  it; its question stays open there, and answering runs the turn on. Only running cards and the copilot stay put.
- A thread can't throw away other cards' uncommitted work: a hook (`lib/git-guard.ts`) turns away `git stash` (but
  `list`/`show`), `git reset --hard`, checking out or restoring paths over the worktree, and `git clean -f`, and says how
  to commit by path, read a clean copy with `git show HEAD:path` or commit through a temp index instead. A scratch clone
  in the temp folder is left alone.
- A thread can't restart Weft while other cards' turns run: a hook (`lib/restart-guard.ts`) turns away `kill`, `pkill`,
  `killall` or port-freeing aimed at Weft's own server, app or port, and a second `npm run dev` / `electron .` in
  Weft's folder, saying how many turns it would cut off. Alone on the board it's allowed; your project's dev server always is.
- A card whose CLI goes on working after its turn ended shows Running again, so a restart then finds it cut off instead
  of leaving it in Review with a tool call and no reply.
- Weft opens on the project you had selected last, with its sort order. They were kept per port, so a launch
  that started the server on another port forgot them (`lib/view-prefs.ts`).
- The board no longer fails to build when a card menu loses the library's star menu: ☆ stars or unstars a card in one
  click, and right-click Star/Unstar and Tags… work (a tag editor until the tag pills land).
- A thread's big heredoc no longer stalls the board's server in the secret guard: a 1.2 MB script with a few `{a, b}`
  groups took 300+ s (256 copies of itself, every token path-checked) and now takes ~0.2 s (`lib/secret-guard.ts`).
- The secret guard no longer stops a thread editing code that mentions `.env`: a `sed -e` script or a Python or
  Node edit whose text names `.env.local` runs; code that opens a `.env` file is still turned away (`lib/secret-guard.ts`).
- The usage strip shows reset times to the minute ("reset 11:06pm"), not rounded to the hour.
- A review tour arriving while you type no longer strands your message: it moves into the step's feedback box, focused.
- Threads write their pane pages (plans, commit checklists, how-tos) to `~/.weft/show/`, not `/tmp/weft-show/`, so
  they survive a reboot; macOS had been clearing them after a couple of days (`lib/show-dir.ts`).

## [0.3.0] - 2026-10-11

### Added
- Card library: star a card (☆ on cards and thread headers) to keep it as a recipe (a Claude skill), a to-do or a note;
  filing a card as a to-do takes it off the board.
- Archive with undo, picture cards (the latest thread image or a pane capture) and Haiku emoji tiles.
- Cards with a placeholder title get a Haiku title and emoji after their turn.
- Header code quality badge with a checklist (coverage, file size, lint, types, guardrails) and a refactor scout that
  starts a card per finding.
- Commit pile: the header's "+N/-N" uncommitted counter and a card that commits it one Review card at a time.
- Progress: streaks, XP, badges and a builder card.
- Startup screen shows why the board didn't load (Retry, Logs, Quit) instead of a stuck splash or blank window.
- Filter: the / key is always shown, matching cards drop down, and the search hands off to the command palette.
- Double-click empty board space to open New thread.
- Send later offers the weekly reset; Tab in the reply box takes the suggested next message.
- Composer drafts and tooltips, browser pane zoom, crash guards around every card and panel.
- The steel weave emblem is the app icon.
- `/weft:done` runs with three agents and the refactor scout.
- Component tests for CardView, ReplyBox and NewCardDialog; tests now cover every line of `lib/` and `app/api/`.

### Changed
- Dollar costs are gone from the board.

### Fixed
- Archived cards no longer count as needing you or running.
- Escape closes the open thread even mid-reply, and dialogs close before board panels.
- Only http(s) URLs can count as Weft itself in the browser pane.
- Long question lists scroll inside the thread panel.
- The commit walk-through says commit, push and /done instead of save.

## [0.2.0] - 2026-10-10

### Added
- Board tools (`mcp__board__*`) in every thread, prompt automations, effort levels, themes and chimes.
- Threads always show something in the browser pane; the glance page fills in when a turn showed nothing.
- Busy-folder and overlapping-edit warnings on cards, the reply box and the New thread dialog.
- The copilot hears what finished or needs you since its last message.
- Terminal drawer: a real shell per folder, with splits.
- Searchable shortcuts sheet, key hints and a hold-a-modifier cheat card.
- Command palette shows each result's project and status; searches the current project, Tab for all.
- The browser pane restores each card's last page after a restart.
- Send later: a clock beside Send that holds a reply until a set time.
- Native right-click menus for cards and columns; rename a card from its open thread.
- Default permission mode (Auto) and an effort setting that follows the last card.
- `/weft:setup-done`, a tighter `/weft:done`, and typing /done archives the card when its turn ends.
- Open-source repo files (license, contributing, security, issue and PR templates, CI) and a Vitest suite.

### Changed
- Cards always open full screen; the side-panel mode is gone.
- Review steps are pages, and the review feedback box uses the shared composer.

### Fixed
- Escape in the browser pane closes the board's newest layer; every dialog shares one Modal.
- The dev server evicts stale listeners and clears a stale Turbopack cache.
- Status lines quoted in code fences are skipped.
- A card that adopts a warm spare gets its session id at once.

## [0.1.0] - 2026-10-09

### Added
- Weft: a desktop kanban board where every card is a Claude Code thread, with a browser pane beside the board.
- Prompts with inline screenshots, video, dictation and a repo picker; skill typeahead on `/`.
- Board skills and automations; review tour, per-card browser, dev server start and the preview skill.
- Command palette search over your prompts; keyboard shortcut registry and a `?` sheet.
- Status strip with plan quota, project and branch; choose the Claude model per thread.
- About window with version, server port and PIDs; the start screen.

[Unreleased]: https://github.com/aimhuge/weft/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/aimhuge/weft/releases/tag/v0.3.0
