# Secrets

Status: steps 1 (guardrails) and 2 (device key and local vault) built 2026-10-11; step 3 (agent tools, dev-server
injection, redaction) built 2026-10-12 except `request` and values for HTTP requests; the rest is design.

Weft keeps two kinds of secrets apart:

- **Weft's own**: the Supabase service-role key, the database password, the GitHub and Google OAuth client
  secrets. They live only on the server side (Supabase and the host's environment) and never ship in the
  desktop app. The app carries only the publishable key (`lib/account.ts`); row-level security guards the data.
- **Yours**: your projects' `.env.local` values and their Vercel environments. Weft keeps them in its own
  vault, end-to-end encrypted, so they can be shared with a team later without Weft's servers ever
  reading them, and pushes them to Vercel from your machine.

## The one rule

A secret's **value** never enters an agent's context. Once a thread has seen a value, it's in the model
request, in `~/.claude/projects/*.jsonl` and `~/.weft/threads/` (plaintext, forever), in the search index,
and possibly in pane pages, review tours and commits. Threads work with **names**; Weft puts **values**
in at the edge: a dev server's environment, a Vercel API call.

## Keys (built for teams from day one)

Envelope encryption, the same shape as 1Password or Bitwarden. Working solo is a one-member team:

```
device keypair (X25519)     private key in the macOS Keychain via Electron safeStorage; public key in Supabase
        │ wraps (sealed box)
vault key (256-bit, random) one per vault, versioned; a "grant" row holds it wrapped for each member device
        │ encrypts (XChaCha20-Poly1305, AAD = vault id + name + environment + key version)
secret values               ciphertext rows in Supabase, never plaintext anywhere off your machine
```

- **A vault per project**, identified by its GitHub repo (`owner/name`, read from `git remote`).
  Because sign-in is GitHub, a teammate who clones the same repo finds its vault.
- **Adding a device or a teammate**: a device that already has a grant wraps the vault key to the new
  device's public key. Supabase only hands over public keys, so the new key's fingerprint is shown on both
  screens to compare (trust on first use, like Signal's safety numbers). Otherwise a compromised server could
  slip in its own key.
- **A recovery key** (shown once, for a password manager or paper) gets its own grant, so losing every
  device doesn't lose the vault.
- **Removing someone**: rotate the vault key (new version, re-encrypt, re-grant everyone else) **and** list
  every secret they could read as "rotate at the provider". They had the plaintext; no re-encryption takes
  that back.
- Crypto via `libsodium-wrappers` (sealed boxes, XChaCha20), not hand-rolled on `node:crypto`.

## Tables (Supabase, all with row-level security)

| table | holds | who can read |
|---|---|---|
| `devices` | user, name, public key, revoked_at | members of a shared vault (public keys only) |
| `teams`, `team_members` | team, user, role (owner/admin/member) | members |
| `vaults` | team or personal owner, repo, current key version | members |
| `vault_grants` | vault, device, key version, wrapped key | that device's user only |
| `secrets` | vault, name, environment (development/preview/production), ciphertext, nonce, key version, version, updated_by | members (ciphertext only) |
| `secret_events` | vault, name, actor, action, time: append-only, no values | members |
| `vercel_links` | vault ↔ Vercel project and team id (no token) | members |

RLS decides who can fetch ciphertext; encryption decides who can read it. Supabase never holds a key that
opens a vault. Writes use a `version` column for optimistic concurrency, so two people editing the same
secret get a conflict instead of one silently overwriting the other.

## Where code runs

- **Electron main process** holds the device private key, unwraps vault keys and decrypts. The board talks
  to it over IPC (`electron/preload.cjs`). Plaintext never goes through a Next API route.
- **The Next server's environment reaches every agent**: `cliEnv()` (`lib/env.ts`) copies `process.env`
  into each CLI. So no secret may live in the server's env, and any internal token between main and the
  server must be stripped in `cliEnv()`.
- **Dev servers** (`lib/devserver.ts`) get the vault's development values in their env; agent shells don't.
- **Vercel push** runs on your machine with your own Vercel token (Keychain). Weft shows a diff
  (missing, changed, extra per environment) and every write needs your click; agents can't push.

## Where you find it: the left rail

The vault is a 🔐 icon on the library rail (`components/LibraryRail.tsx`), under ↻ ☑ ✎ and separated by a
divider. It adds no new row: its count badge carries the nudges ("3 missing", or a dot when `.env.local`
holds values not yet imported). It opens the same drawer the library uses (over the board, or pushing it
when pinned), with every board project's vault. A project filter at its top follows the top bar's project;
picking another there holds until the top bar's project changes (`vaultFilter` in `lib/vault-view.ts`). The
rail's badge counts the top bar's project only.

- **The drawer**: names grouped by environment (development / preview / production), masked tails, an
  Add button (also Shift+`S` and the palette's "Add a secret": `addSecret()` in `lib/use-vault.ts` opens the drawer and the drawer's `onSecretAsk` taker opens the form on the first vault shown, once it has loaded) (name, environment and a hidden value, typed into the board and sent once to main, so projects
  with no `.env` file get a vault too), ✎ / Change Value… for a new value, Copy to <project> in the right-click
  menu (one item per other project, since menus have no submenus; main decrypts and re-encrypts across, so
  the value never reaches the board), an Import button, a Vercel diff ("2 not on preview"), and, once teams arrive, members and the event log.
- **Revealing or copying a value asks for Touch ID** (`systemPreferences.promptTouchID`); the drawer
  locks again after a few idle minutes.
- **The vault's IPC bridge goes only to the board window**, never to browser-pane pages
  (`electron/browser-pane.cjs`): pane pages are agent-driven and can be any site.

## Importing `.env` files

Most projects already have their secrets in `.env.local`, so that's how a vault gets started.

- **Main reads the file**, not an agent: `fs` plus a dotenv parser in Electron main, so values go from the
  disk straight into the vault. It handles quotes, multiline values, `export` prefixes, and stores
  `${VAR}` references as written.
- **The file name sets the environment**: `.env.local` and `.env.development.local` → development,
  `.env.production.local` → production. `.env` holds shared defaults (often committed); it's offered but
  left unticked. `.env.example` brings in **names only**, which show as "missing" until filled.
  Monorepos: scan `apps/*` and `packages/*` too.
- **Preview before anything is written**: each name, masked tail, and new / same / differs from the vault,
  each with a checkbox. `NEXT_PUBLIC_*` gets a "public" tag (it ends up in the browser bundle anyway).
  Files written by `vercel env pull` (`# Created by Vercel CLI`) skip short-lived values like
  `VERCEL_OIDC_TOKEN`.
- **Nudge**: a dot on the rail's 🔐 when a project has a `.env.local` that isn't in the vault; the drawer says "Found 14 secrets in
  .env.local: move them into the vault?"
- **Committed file?** If git tracks the `.env` file (`git ls-files`), warn loudly: those values are in
  history, so rotate them at the provider instead of just importing.

### After import: the file stays, managed by Weft

`next dev`, Prisma, the Supabase CLI and scripts you run yourself all read `.env.local` directly;
injecting values only reaches processes Weft starts. So the vault stays the source of truth and
**Weft writes `.env.local` back out** with a `# Managed by Weft` header (gitignored, mode 0600, agents
denied). A file watcher notices hand edits and offers "Import changes", so editing the file still works.
(Decided 2026-10-11: keep the file. A no-file "strict mode" is out of scope for now.)

## What agents get

- `mcp__secrets__list` (built): names, environments and whether each is missing, for the card's folder or another
  project by path. Never values, not even tails.
- `mcp__secrets__fill_field(name, selector, environment?, project?)` (built): Electron main types the value into a
  field on the card's pane page. The thread never sees it. How:
  - `lib/secret-tools.ts` calls the pane's control server (`POST /secrets/fill`); `electron/pane-secrets.cjs` refuses
    anything but https, then asks `vault.useFor()`.
  - `useFor` asks for Touch ID ("let a thread type NAME (owner/repo) into site"). Approvals are their own, one per card,
    site and vault, open for `UNLOCK_MS` from the last use: the drawer being unlocked never lets a thread in, and a yes for
    one site never covers another. Lock clears them.
  - The pane types the value (`electron/pane-actions.cjs`), masks the field with `-webkit-text-security` so screenshots
    don't show it, and `read_page` swaps the value for `‹NAME›` in the page's text and title.
  - The tools are trusted (`isTrustedTool`): Touch ID is the one yes, with no permission prompt before it.
  - Limits: a page's own script can still read a field it was given (that's what the field is for), so the https rule
    and the site in the Touch ID prompt are the guard against a thread filling a page it controls.
- `mcp__secrets__run(command, names, environment?, cwd?, timeout_seconds?, project?)` (built): a command with vault
  values in its env, for a thread that never sees them. The motivating case: `DATABASE_URL` is in the vault and a thread
  runs `npm run job` or a migration.
  - The Next server (`lib/secret-run.ts`) checks the command (`lib/secret-command.ts`) and splits it into argv; it never
    holds a value. One plain command only: anything a shell would read outside single quotes (`|`, `>`, `;`, `&&`, `$VAR`,
    `$(…)`, backticks) is refused, since main runs it with no shell. Also refused: shells and `eval`, wrappers that run
    another command (`env`, `sudo`, `xargs`), env dumps (`printenv`), network tools (`curl`, `wget`, `nc`, `ssh`), inline
    code (`node -e`, `python -c`, `perl -pe`, `awk`, `npx -c`), and setting a vault name on the command line.
  - For `npm run X` (and `pnpm`, `yarn`, `bun run`) it reads `package.json` so the approval shows what really runs,
    with `preX` and `postX`.
  - Electron main (`electron/secret-run.cjs`) gets the values (`vault.valuesFor`, main only, never over IPC) and asks:
    a dialog with the command, the folder, the script and the names (Cancel / Allow once / Always allow), then Touch ID.
    *Always allow* is a rule in the data folder's `vault/run-rules.json` (`electron/run-rules.cjs`), sealed with
    safeStorage so a thread can't write one. It pins the vault, environment, folder, exact command and a hash of the
    script, and covers those names or fewer, so a thread editing the script makes it ask again.
  - Main spawns argv detached with no shell, its own env minus `THREADBOARD_SHELL_*`, plus the values; a timeout
    (default 2 minutes, at most 10) sends SIGTERM to the process group, then SIGKILL. Output is redacted
    (`electron/secret-redact.cjs`), then cut to the last 20,000 characters, and comes back with the exit code.
- Redaction (`electron/secret-redact.cjs`, built): each value and the forms programs print it in, swapped for
  `‹NAME›`: as written, JSON-escaped, URL-encoded (`%20` or `+`, either hex case), base64 and base64url, including
  base64 of the value inside a longer string (the three byte alignments). Values under 4 characters are left alone.
- Dev servers (built): `lib/devserver.ts` asks main for a one-time grant of the folder's development values
  (`POST /secrets/dev-grant`, approved like a run, *Always allow* as a `dev` rule). It starts `electron/secret-env.cjs`
  with Electron as node and writes the control-server token, the grant and argv to its **stdin**, so neither sits in a
  process's environment. The wrapper claims the values (`/secrets/claim`, once, within a minute), runs the command
  with no shell, and redacts its output line by line. A command the policy refuses, a no or no vault starts the server
  the plain way, with a note in its log. Dev servers no longer inherit the control-server token either (`cliEnv()`).
- Stored results (built): main remembers the values each card used (a run, a fill, a dev server). `lib/runner.ts` sends
  that card's tool results through `POST /secrets/redact` before writing them to Weft's thread files (and so the search
  index); if main can't answer, the result is stored as "output hidden". Limits: the model saw the result as it was,
  the CLI's own transcript in `~/.claude/projects` keeps it, and the model's reply text isn't redacted.
- Not built: `mcp__secrets__request(name, environment, why)` (the card moves to *Needs you* with a paste field), values
  for HTTP requests (a header), a list of remembered approvals in the drawer, and patterns like `npm run job:*`.
- A PreToolUse hook (`lib/secret-guard.ts`, on every thread and the refactor scout) denies reading `.env*`
  (except templates like `.env.example`), `~/.weft/account.json`, the device key and the vault files. It's a
  hook, not `canUseTool`, because reads never ask, and `bypassPermissions` skips `canUseTool` entirely.
  - Files: `Read`, `Edit`, `NotebookRead`, `Grep` (by path or glob, so `*.local` counts too), and the browser
    pane opening a `file://` URL to one.
  - Bash: commands go through a shell parser (`lib/shell-parse.ts`) that follows quotes, escapes, heredocs,
    redirects, `$(…)`, `sh -c`, `eval`, `xargs` and `find -exec`. A command is turned away only when it is the
    one reading the file: `cat .gitignore | grep .env` runs, while `cp .env.local x` and `cat .e*` don't.
  - Code: `sed -e`/`grep -e` scripts and an interpreter's inline code (`python3 -c`, `node -e`, a heredoc) may
    mention `.env` freely; code is turned away only when it opens one (`open(…)`, `readFileSync(…)`, `Path(…)`,
    `subprocess.run(…)`, Ruby/Perl backticks, or a variable set to the path when the code opens something).
  - Dumps: `printenv`, bare `env`/`export`/`set`, `ps e`, `console.log(process.env)`, `print(os.environ)`,
    `echo $SOME_KEY`, and `vercel env pull` to stdout.
- Paste guard in the Composer: text that looks like a key (`sk_live_`, `ghp_`, high entropy) offers
  "Save as secret instead".

Limit: an agent with unrestricted Bash can still print the env of a process it can reach, or write a script
that opens the file itself. This is a strong default, not a sandbox. Known gaps after the audit:
- The env strip removes only `THREADBOARD_SHELL_*`, so other secrets in your login shell's env reach threads.
- `THREADBOARD_SHELL_TOKEN` sits in the Next server's env; `ps e` is blocked, but a script could still read it.
- gitleaks is skipped in the pre-commit hook when it isn't installed; CI pins it but hasn't run yet.
- The paste guard checks pastes only, not typed or dropped text.

## Already exposed today

- Fixed 2026-10-12: the Supabase session, refresh token included, is `~/.weft/account.sealed`, encrypted by
  safeStorage in Electron main (`electron/account-store.cjs`). The Next server reads and writes it through main's
  token-guarded control server (`POST /account/read` and `/account/write`, `lib/account-storage.ts`); an old plain
  `account.json` moves in on first read and is deleted. Outside the desktop app (`npm run dev` in a browser) there's
  no main, so it's still the plain file there.
- Fixed in step 1: the secret guard turns away a thread's `cat .env.local`.

## How step 2 is built

- `electron/env-writeback.cjs`: the import preview offers "Then let Weft write .env.local from the vault" when the
  project has a `.env.local` Weft doesn't write yet. `vault.writeBack(folder)` refuses a file git tracks, or one
  holding a value the vault doesn't (import it first); otherwise it adds `.env*.local` to `.gitignore` if git doesn't
  ignore it, and writes the development values under a `# Managed by Weft` header (mode 0600, renamed into place;
  names still missing are comments). From then on every change to that vault (add, import, copy, remove) rewrites
  every managed `.env.local` of its folders. A watcher on the folder (not the file, which each write replaces) sends
  `vault:changed` to the board when the file changes into something Weft didn't write, and the nudge reads "You
  edited .env.local: import the change into the vault?". A line you delete by hand comes back at the next rewrite.

- `electron/vault-crypto.cjs`: libsodium. `newKeypair` (X25519), `newVaultKey`, `wrapKey`/`unwrapKey` (sealed
  boxes), `encrypt`/`decrypt` (XChaCha20-Poly1305 with `aad(vaultId, name, environment, keyVersion)`).
- `electron/device-key.cjs`: `~/.weft/device-key.json` holds the public key and the private key encrypted by
  `safeStorage`; with no safeStorage, Weft refuses instead of writing the key in the clear.
- `electron/vault-store.cjs`: one `~/.weft/vault/<hash of id>.json` per vault (mode 0600): the key version, a
  grant per device (the vault key sealed to it), and entries with ciphertext, nonce and key version. A name from
  `.env.example` is an entry without ciphertext ("missing"). `list` returns names and 4-character tails only.
- `electron/dotenv.cjs`: the parser and the file rules (which file feeds which environment, names-only
  templates, Vercel pulls). `electron/vault.cjs`: the vault id from `git remote` (`github:owner/name`, or
  `folder:<path>`), the overview with the nudge, the import preview, `importPicks` (which reads the files again
  in main, so values never pass through the board), `setValue` (a typed secret; checks the name) and `copyTo`
  (vault to vault, in main), reveal and copy behind `createUnlock` (Touch ID, open for 3
  minutes from the last use), and `registerVault`, whose IPC handlers refuse any sender but the board's
  webContents.
- The board: `window.threadboard.vault` (`electron/preload.cjs`), `lib/vault-view.ts` (what the drawer shows),
  `lib/use-vault.ts` (loads on folder change and window focus; `useIdle` locks after 3 idle minutes), and
  `components/VaultDrawer.tsx` (its row, form, filter and import preview in `components/VaultParts.tsx`)
  inside the library drawer's shell in `components/LibraryRail.tsx`.

## Build order

1. **Guardrails** (no backend needed): the secret-guard hook, the env strip in `cliEnv()`, gitleaks
   in Weft's own pre-commit hook and CI, the Composer paste guard. Built; audited 2026-10-11.
2. **Device key and local vault** (built 2026-10-11): keypair in the Keychain, the vault in main, a Secrets panel per
   project, `.env` import with preview and nudge. Finished 2026-10-12: `.env.local` written back with a watcher for
   edits (`electron/env-writeback.cjs`), and the refresh token moved behind `safeStorage`.
3. **Agent tools, dev-server injection, redaction.** Built 2026-10-12: `list`, `fill_field`, `run`, dev-server injection,
   redaction of stored tool results. Still open: `request`, values for HTTP requests, the approvals list in the drawer.
4. **Supabase sync**: the tables above with ciphertext only, multi-device grants, recovery key.
5. **Vercel push**: diff view, per-environment push with confirmation.
6. **Teams**: invites, fingerprint check, roles, rotate-on-remove, the event log in the panel.
