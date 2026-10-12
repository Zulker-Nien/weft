# Weft account sign-in

The Weft account is optional: the board works signed out, and signing in unlocks cloud features (page sync,
share links). Sign-in runs in the system browser, never in the Weft browser pane, and uses Supabase Auth
with PKCE so the verifier only ever lives on this machine.

## Redirect target

The OAuth and magic-link flows redirect to a stable, port-free URL Weft owns:

```
weft://account-callback
```

This is a custom URL scheme Weft registers with the OS. The dev server's HTTP port changes on every
Weft restart, so a `http://127.0.0.1:PORT/...` redirect would break after each launch; the `weft://`
scheme doesn't carry a port, so the URL is permanent.

In the packaged app, `app.setAsDefaultProtocolClient("weft")` (in `electron/main.cjs`) registers
the installed Weft.app as the OS handler. In `npm run desktop` the dev Electron (`com.github.Electron`)
has no `CFBundleURLTypes` declared in its Info.plist, so macOS silently drops `weft://` clicks.
`scripts/dev-protocol.cjs` builds a thin wrapper app at `~/Applications/Weft Dev.app` with
`weft://` declared, registers it with LaunchServices, and forwards the link to the running dev
Electron (the wrapper's launcher execs the real Electron with the project as its folder and the
URL as a `--weft-link=weft://…` arg; `argvLink` in `electron/argv-link.cjs` parses it back out
for the `second-instance` handler). `npm run desktop` runs the script before launching Electron,
and `npm run dev:protocol` runs it standalone.

`lib/account.ts:redirectUrl()` returns the scheme when the build is the desktop app
(`process.env.THREADBOARD_SHELL_URL` is set), and falls back to the loopback HTTP origin for plain
`next dev` (no Electron, no `weft://` handler at all).

## From link to session

1. The user clicks **Sign in → GitHub** in the Weft top bar.
2. The board calls `POST /api/account` → `startSignIn("github", origin)` → Supabase's `signInWithOAuth`
   with `redirectTo: weft://account-callback` and `skipBrowserRedirect: true`.
3. The board opens the Supabase authorize URL in the system browser via `shell.openExternal`.
4. The user authorizes on GitHub. GitHub → Supabase → `weft://account-callback?code=…`.
5. The OS hands the URL to the Weft app: `open-url` (mac) or `second-instance` (Linux/Windows).
6. `handleLink` in `electron/main.cjs` sees the link is for the account callback and hands it to
   `accountLink.handle()` (built by `createAccountLink()` in `electron/account-link.cjs`). The handler
   parses the query string with `accountCallbackBody()` and POSTs it to `/api/account/weft-callback`
   on the loopback server with `x-threadboard: 1` and `content-type: application/json`. The shared
   `warnUser` (in `electron/main.cjs`) is the single dialog the account-callback path uses for
   errors; `pageLinks` and `accountLink` both take it as `warn`, so the two flows stay in step.
7. The route (`app/api/account/weft-callback/route.ts`) calls `finishSignIn(code)` (in
   `lib/account.ts`), which exchanges the code against the PKCE verifier kept in the session file
   (`~/.weft/account.json` or the Keychain via `electron/account-store.cjs`).
8. Success is silent; the board's `useAccount` polling (every 2s while `waiting` is set) picks up
   the new session. Errors render a small green/red page built by `accountPage()` in
   `lib/account-page.ts`; that same helper backs the HTTP loopback callback at
   `/api/account/callback`, so both flows show the user the same page. The Electron handler shows
   the same message in a native dialog (it pulls the visible `<h1>`/`<p>` out of the HTML
   response so the dialog matches the browser).

## Where it shows

- `lib/use-account.ts` is the one hook behind both views: it loads `GET /api/account`, polls every 2s for up to
  5 minutes while a sign-in finishes in the browser, and keeps every instance in step with a `weft:account` window
  event (the board fires it for the server's `account` event; sign in and sign out fire it too).
- `components/AccountButton.tsx`: the top bar button, right of Copilot (`CopilotButton.tsx`). Signed out it is the
  GitHub mark and "Sign in" (starts GitHub); signed in it is just your avatar (`components/Avatar.tsx`), which opens
  Settings. It renders nothing until the account loads, on a load error, or when accounts aren't configured.
- `components/AccountSettings.tsx` (Settings → Weft account): GitHub and Google buttons, an email-link form, who you
  are, and Sign out (this Mac only).

## Database

`supabase/migrations/` (applied to Weft prod through the Supabase MCP; the file versions match the server's):

- `profiles`: one row per user (id → `auth.users`, email, name, avatar), row-level security on, select and update
  only your own row, and only `name` and `avatar_url` are updatable. `private.handle_new_user()` is a
  `security definer` trigger on `auth.users` that creates the row; it lives in the unexposed `private` schema.
  Display fields come from `user_metadata`, which users can edit, so nothing may authorize on them.
- `lock_rls_auto_enable`: revokes the Data API's access to Supabase's own `public.rls_auto_enable()` event-trigger
  function (an advisor warning); the trigger still fires.

## Supabase project setup

For the sign-in flow to complete, the Supabase project's **Authentication → URL Configuration →
Redirect URLs** allowlist must include `weft://account-callback`, and, to sign in from plain `next dev` (a browser
tab, no Electron), `http://127.0.0.1:*/api/account/callback` and `http://localhost:*/api/account/callback`. The
`Site URL` (used as a fallback) should not be relied on; set the allowlist entries explicitly. Email links use the
same allowlist and need custom SMTP before real users (the built-in mailer sends a few a hour).

The GitHub provider itself is configured under **Authentication → Sign In / Providers → GitHub** with
the GitHub OAuth app's client ID and secret, and the GitHub OAuth app's **Authorization callback URL**
must be `https://<project-ref>.supabase.co/auth/v1/callback` so Supabase can exchange the OAuth code
with GitHub.
