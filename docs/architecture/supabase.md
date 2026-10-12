# Supabase

Status: linking built 2026-10-12 (pick an existing project; new ones are made on supabase.com). Migrations push,
types, keys into the 🔐 vault and agent tools are next.

Supabase's green bolt on the left rail (under ▲, in `components/LibraryRail.tsx`) opens a drawer that links each
board project to a Supabase project, the same way ▲ links one to Vercel (docs/architecture/vercel.md).

## The token

- You paste a personal access token (`sbp_…`) from supabase.com/dashboard/account/tokens into the drawer. Main checks
  it (`GET /v1/organizations`, which also names the orgs shown under the header) before keeping it.
- Main seals it with Electron's `safeStorage` (Keychain) in `~/.weft/supabase-token.json` (mode 0600), and refuses
  without safeStorage rather than writing it in the clear.
- The token never leaves main: every Management API call (`api.supabase.com/v1`) is made there, and the board gets
  back names, refs, regions and states. `lib/secret-guard.ts` denies threads `supabase-token.json`.
- Weft doesn't read the Supabase CLI's own login (`~/.supabase/access-token` or the Keychain entry it makes).

## The link

A link is `supabase/.temp/project-ref`, the file `supabase link` writes, plus `.temp` in `supabase/.gitignore` (as
`supabase init` does). No Weft-side state: the Supabase CLI in a thread (`supabase db push`, `supabase gen types
--linked`, `supabase migration list`) works on the right project with no prompt, and a folder linked by the CLI shows
up linked in the drawer.

- A folder whose `.mcp.json` points the Supabase MCP server (`https://mcp.supabase.com/mcp?project_ref=…`) at a
  project counts as linked too ("Linked in .mcp.json"). The drawer won't change that checked-in file: its button
  is **Link CLI…**, which writes the CLI's file as well.
- **Link…** lists every project the token reaches; `pickerList` in `lib/supabase-view.ts` puts best fits first (the
  repo's or folder's name 2, a name containing it 1), then newest. Supabase projects have no git link to match on.
- **+ New project on supabase.com ↗** opens the dashboard: making a project through the API needs a database
  password and a region, which belong in a form there (or later, in the vault).
- **Unlink** removes `supabase/.temp/project-ref` only; the Supabase project is untouched.

## What the drawer shows

For a linked folder: project and org, its state (Healthy, Paused, Restoring…; `projectState`), region, the API URL
(click to open the project's dashboard in the browser pane), the folder's migrations against the ones Supabase has
applied (`GET /v1/projects/:ref/database/migrations`, matched by the version before `_` in
`supabase/migrations/<version>_<name>.sql`; "2 of 5 migrations not applied: …" in amber), and links into the
dashboard on one line: Auth, Logs, Keys, Usage and Dash (`supabaseActions`). A paused project (free
projects pause after a week) gets **Restore** (`POST /v1/projects/:ref/restore`).

Status loads only while the drawer is open (`lib/use-supabase.ts`), on open, on folder change and on window focus.
A Weft started before this drawer existed has no `supabase:` handlers in main; the drawer says so and offers
Restart Weft (`needsRestart`).

## Files

- `electron/supabase.cjs`: `createSupabase` (status, token, projects, link, unlink, restore), the folder's side
  (`readLink`, `writeLink`, `localMigrations`) and `registerSupabase`, whose IPC handlers answer the board window only.
- `electron/preload.cjs`: `window.threadboard.supabase`.
- `lib/supabase-view.ts`: types, the bridge, matching, labels, links. `lib/use-supabase.ts`: loading.
- `components/SupabaseDrawer.tsx` (token form, linked folders), `components/SupabasePicker.tsx` (Link…),
  `components/SupabaseLogo.tsx`.

## Next

1. **Push migrations**: a button on "N not applied" that starts a card running `supabase db push` (the link is
   already there for the CLI; the token goes in through `mcp__secrets__run`, never the thread).
2. **Keys into the vault**: copy the project's URL and publishable key into the 🔐 vault as
   `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the service role key behind Touch ID.
3. **MCP for threads**: offer to add the Supabase MCP server for the linked project to `.mcp.json`.
4. **Create in place**: name, org, region, with a generated database password kept in the vault.
5. **Usage and advisors**: security and performance advisors, and a badge when a project is paused or unhealthy.
6. A shared `useDrawerStatus` for `lib/use-vercel.ts` and `lib/use-supabase.ts`, which are the same hook twice.
