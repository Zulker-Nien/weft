# Cloudflare

Status: linking built 2026-10-12 (pick an existing Worker or Pages project). Writing wrangler's `account_id`, Worker
secrets from the vault, logs, and zones / DNS are next.

Cloudflare's orange cloud on the left rail (under Supabase's bolt, in `components/LibraryRail.tsx`) opens a drawer that
links each board project to a Cloudflare Worker or Pages project. It's built like the ▲ Vercel drawer
(docs/architecture/vercel.md): main holds the token and makes every call, the board gets names, URLs and states.

## The token

- The drawer asks for a **setup token**: one made with Cloudflare's "Create additional tokens" template (User → API
  Tokens → Edit, offered by no other template or the custom builder, so the button opens the tokens page rather than a
  prefilled form). Main never keeps it. It tells one from an ordinary token by `GET /user/tokens/permission_groups`,
  which only a token with API Tokens Read/Edit can call, then (`fromSetupToken` in `electron/cloudflare.cjs`):
  1. `GET /user/tokens/verify` for the setup token's own id;
  2. `POST /user/tokens`: "Weft on <hostname>", one policy on `com.cloudflare.api.account.*` (every account you have)
     with `NARROW` from `electron/cloudflare-api.cjs`: Account Settings Read, Workers Scripts Write, Pages Write
     (needed; matched by either of Cloudflare's names) and Workers Tail Read (when offered);
  3. `GET /accounts` with the new token, up to 3 tries a second apart while Cloudflare catches up. If it never works,
     the new token is deleted again and nothing is kept;
  4. seals the new token, then `DELETE /user/tokens/:setupId` with the setup token itself. If that fails the toast
     says so and asks you to delete it on the tokens page (`tokenSavedLine` in `lib/cloudflare-view.ts`).
- Any other token (one you made yourself, or the "Edit Cloudflare Workers" template) is kept as it is. Main checks it
  with `GET /accounts` before keeping it: that works for user tokens and account-owned tokens alike, and a token that
  reaches no account is turned away.
- Signing out forgets Weft's token here only; "Weft on <hostname>" stays on Cloudflare's tokens page until you delete it.
- Main seals it with Electron's `safeStorage` (Keychain) in `~/.weft/cloudflare-token.json` (mode 0600). Without
  safeStorage it refuses rather than writing it in the clear. `lib/secret-guard.ts` denies threads that file.
- Cloudflare's codes for a malformed or revoked token (6003, 6111, 9106, 9109, 1000) or a 401 read as "turned the
  token down"; a 403 otherwise reads as a missing permission, with Cloudflare's own message (`failureOf` in
  `electron/cloudflare-api.cjs`).

## The link

Cloudflare has no per-folder link file like `.vercel/project.json`: wrangler finds the Worker by the `name` in its
config and the account from `account_id` or its own login. So Weft keeps links in `~/.weft/cloudflare-links.json`
(`{ [folder]: { kind: "worker" | "pages", accountId, name } }`) and writes nothing into the folder.

- The folder's wrangler config (`wrangler.jsonc`, `wrangler.json`, `wrangler.toml`; `wranglerOf`) is read for its
  top-level `name` and whether it sets `pages_build_output_dir` (Pages). An unlinked folder says what its config
  names, and a linked Worker warns when the config names a different one.
- **Link…** lists every Worker (`/accounts/:id/workers/scripts`) and Pages project (`/accounts/:id/pages/projects`,
  paged) in every account the token reaches; a list that fails (the token lacks Pages, say) is skipped unless all do.
  `pickerList` in `lib/cloudflare-view.ts` sorts best fits first: the wrangler config names it (4), it builds from the
  folder's GitHub repo (3), it has the repo's or folder's name (2), a name containing it (1); then newest.
- **Unlink** forgets the link only; the Cloudflare project is untouched.

## What the drawer shows

- **Pages**: `GET /accounts/:id/pages/projects/:name`: the address (first custom domain, else `<name>.pages.dev`),
  the latest deployment (its last stage's status: Ready, Building, Queued, Failed, Canceled; the stage name on hover;
  production or preview; click to open it in the pane), the repo it builds from (warns when it isn't this folder's), and
  links to its domains and dashboard.
- **Workers**: `GET …/workers/scripts/:name/deployments` (which must answer: it proves the Worker is there), plus best-effort
  `workers/subdomain`, `workers/domains?service=` and `scripts/:name/subdomain` for the address (custom domain, else
  `<name>.<subdomain>.workers.dev` when workers.dev is on). The newest deployment shows as Deployed with what made it
  (wrangler, dash, api…). Links to its deployments, logs, settings and dashboard.

A link Cloudflare can't read keeps its name and shows the error, so you can still unlink it. Status loads only while
the drawer is open, cached between opens (`lib/use-linked-status.ts`, shared with the other drawers).

A Weft that started before Cloudflare was added has no `cloudflare:` handlers in main (or no bridge in its preload);
the drawer then offers **Restart Weft** (`needsRestart` in `lib/cloudflare-view.ts`, `restartWeft` from
`lib/blastcp-view.ts`).

## Files

- `electron/cloudflare.cjs`: `createCloudflare` (status, token, projects, link, unlink) and `registerCloudflare`, whose
  IPC handlers answer the board window only.
- `electron/cloudflare-api.cjs`: request building (GET, POST, DELETE), `NARROW` and `narrowToken`, errors, reading Cloudflare's answers (`pagesDeploy`, `workerDeploy`,
  `pagesUrl`, `workerUrl`, `pagesGit`) and the folder's wrangler config (`wranglerOf`).
- `electron/preload.cjs`: `window.weft.cloudflare`. The token's own read/persist lives in `electron/provider-token.cjs`, which Vercel, Supabase, Cloudflare and BlastCP all share.
- `lib/cloudflare-view.ts`: types, the bridge, matching, labels. `lib/use-cloudflare.ts`: loading.
- `components/CloudflareDrawer.tsx` (its own two-step setup-token form — it exchanges the pasted token for a narrower one, so it isn't the shared `components/TokenForm.tsx` — plus linked folders on the shared `components/FolderRow.tsx`, restart), `components/CloudflarePicker.tsx` (Link…, on the shared `components/DbSelect.tsx` with `lib/db-picker.ts` `rankItems`),
  `components/CloudflareLogo.tsx`.

## Next

1. **wrangler account**: write `account_id` into the wrangler config (or `CLOUDFLARE_ACCOUNT_ID` into the card's env)
   so `wrangler deploy` in a thread never asks which account.
2. **Secrets**: push 🔐 vault values as Worker secrets / Pages env vars, diffed first, values going vault → Cloudflare in main.
3. **Logs**: a failed Pages build's log; `wrangler tail`-style live logs in the pane.
4. **Zones**: the account's domains and DNS records, for wiring a custom domain to a project.
