# Vercel

Status: linking built 2026-10-12 (pick an existing project or create one). GitHub connect on a linked project,
deploys, env push and logs are next.

▲ on the left rail (under 🔐, in `components/LibraryRail.tsx`) opens a drawer that links each board project to a
Vercel project. It's the base for the rest of the Vercel work: everything after linking needs the token and the
project id this sets up.

## The token

- You paste a token from vercel.com/account/tokens into the drawer. Main checks it (`GET /v2/user`) before keeping it.
- Main seals it with Electron's `safeStorage` (Keychain) in `~/.weft/vercel-token.json` (mode 0600). Without
  safeStorage it refuses rather than writing it in the clear, like the vault's device key.
- The token never leaves main: every Vercel call is made there, and the board gets back only names, ids, URLs and
  states. `lib/secret-guard.ts` denies threads `vercel-token.json`.
- Weft doesn't reuse the Vercel CLI's own login file: reading another tool's credentials is the kind of thing the
  guard is there to stop.

## The link

A link is `.vercel/project.json` (`{ projectId, orgId, projectName }`), the file `vercel link` writes, plus `.vercel`
in `.gitignore`. No Weft-side state: the Vercel CLI in a thread (`vercel deploy`, `vercel logs`, `vercel env ls`)
works on the right project with no prompt, and a folder linked by the CLI shows up linked in the drawer.

- **Link…** lists projects from your account and every team (`/v2/teams`, `/v10/projects` per scope; a scope that
  fails is skipped unless all do). `pickerList` in `lib/vercel-view.ts` sorts best fits first: the project deploys
  from the folder's GitHub repo (3), has the repo's or folder's name (2), or a name containing it (1); then newest.
- **+ New project** (`components/VercelCreate.tsx`): a name (the repo's name, else the folder's, made Vercel-safe by
  `projectNameFor`), a team (from `scopes()`: your teams, plus Personal only on an older account with no default
  team; your default team first), and "Deploy from GitHub owner/name". Main `POST /v11/projects` with the framework
  from `package.json` (`frameworkOf`), writes the link, then `POST /v9/projects/:id/link` for the repo. If connecting
  GitHub fails (usually the Vercel GitHub app can't see the repo) the project stays made and linked, and the toast
  says why.
- **Unlink** removes `.vercel/project.json` only; the Vercel project is untouched.

## What the drawer shows

For a linked folder: project and team, the production URL (first alias), the latest deployment (state, production
or preview, age; click to open it in the board's browser pane), whether it deploys from this folder's repo (warns
when it doesn't, or deploys from another repo), and a row of vercel.com links (`vercelActions` in `lib/vercel-view.ts`):
the latest deploy's page (its `inspectorUrl`), runtime logs, env vars, domains and the dashboard. The dashboard is
`vercel.com/<team slug or your username>/<project>`; only with neither does it fall back to `vercel.com/dashboard`,
and then the logs, env and domains links are left out. A link Vercel can't read keeps its ids and
shows the error, so you can still unlink it. Status loads only while the drawer is open (`lib/use-vercel.ts`), on
open, on folder change and on window focus, since each load is a few API calls per project.

## Files

- `electron/vercel.cjs`: `createVercel` (status, token, projects, scopes, link, create, unlink) and `registerVercel`,
  whose IPC handlers answer the board window only.
- `electron/vercel-project.cjs`: request building, reading Vercel's answers (`deploymentOf`, `gitOf`,
  `productionUrl`), and the folder's side (`readLink`, `writeLink`, `ignoreVercel`, `frameworkOf`, `repoOf`).
- `electron/preload.cjs`: `window.threadboard.vercel`.
- `lib/vercel-view.ts`: types, the bridge, matching, labels, name rules. `lib/use-vercel.ts`: loading.
- `components/VercelDrawer.tsx` (token form, linked folders), `components/VercelPicker.tsx` (Link…),
  `components/VercelCreate.tsx` (+ New project).

## Next

1. **Connect GitHub** on a project that's linked but doesn't deploy from its repo (same `/link` call as create).
2. **Deploy**: list recent deployments, redeploy, promote; open a preview in the card's pane after a push.
3. **Env push**: diff 🔐 vault values against Vercel's environments, push per environment with a click
   (docs/architecture/secrets.md, step 5). Values go from the vault to Vercel inside main.
4. **Logs**: build logs of a failed deploy, runtime logs, in the drawer or the pane.
5. **Agent tools**: `mcp__vercel__*` for status and logs, with the token kept in main.
