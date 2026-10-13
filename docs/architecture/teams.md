# Teams

Status: phase 1 (workspaces, members, roles, email invites on weft.zip) built 2026-10-13. Phase 2, the shared 🔐
vault, is designed in [teams-vault.md](teams-vault.md).

A Weft account has a **workspace** from its first sign-in (solo is a team of one). Owners and admins invite people by
email; an invite link joins whichever account opens it. Billing (`/[orgSlug]/billing`) and the shared vault hang off
the same workspace id.

## Where it runs

Team management lives on the deployed Weft (weft.zip), not in the desktop app:

- The org tables are service-role only (RLS on, no policies), and the service key never ships in the desktop.
- The desktop's account menu has **Your team**, which opens `https://weft.zip/team` in the browser pane. The pane
  keeps its own cookie session, so the first visit asks for GitHub once.

```
desktop ── pane ──▶ weft.zip /team ─▶ /<slug>/team ──(service role)──▶ Supabase orgs · org_memberships · invitations
                         ▲ cookie session (proxy.ts refreshes it)
```

## The package, and what Weft doesn't use

`@aimhuge/teams` (from `aimhuge/components`, `packages/teams`) is installed as a packed tarball,
`vendor/aimhuge-teams-0.1.0.tgz`, packed from the commit `4e36dc9` on components' `main`. It isn't tagged yet; once
it is, pnpm can install it straight from git (`github:aimhuge/components#vX&path:/packages/teams`).

Weft uses its pure helpers: `listUserOrgs`, `listOrgMembers`, `setCurrentOrg`, the role helpers (`roleCan`,
`assignableRoles`, `roleLabel`, …), the invite flow (`createInvite`, `lookupInviteByToken`, `acceptInvite`,
`listPendingInvites`, `revokeInvite`) and the email helpers.

It **doesn't** use the package's `requireOrg`, `sessionClaims`, its server actions or the client components that call
them. 0.1.0 passes a `SupabaseClient` into a `"use cache"` function, and Next 16 hands a cached function a
non-serializable argument as a temporary reference that throws when touched ("Cannot access from on the server. You
cannot dot into a temporary client reference"; reproduced 2026-10-13 on Next 16.4.0). The fix is a Backlog card in
`~/dev/components`. Until then Weft has its own gate and actions, below.

## Files

- `supabase/migrations/20261013170000_teams.sql`: `orgs`, `org_memberships`, `invitations` (the package's 0001/0002
  schema), profile columns the package reads (`current_org_id`, `display_name` generated from `name`,
  `last_login_at`, `login_count`), and `private.create_personal_org` with the `on_auth_user_created_workspace`
  trigger and a backfill. Weft keeps its own copy because the package's 0001 replaces `on_auth_user_created`, which
  would drop the name and avatar Weft's trigger fills in. Slugs come from the GitHub login (`private.org_slug_for`),
  skipping the package's reserved words and Weft's root routes.
- `lib/supabase-project.ts`: the project URL and publishable key, with no Node imports so `proxy.ts` can use them.
- `lib/web-session.ts`: the weft.zip visitor's cookie session (`webClient`, `webUser` from the JWT claims) and the
  service-role client (`serviceClient`, from `SUPABASE_SECRET_KEY`, set on the deployment only).
- `proxy.ts`: refreshes the session cookie before the team pages render (Server Components can't write cookies).
  Deployed only; matches `/login`, `/app`, `/team`, `/invite/*`, `/<slug>/team/*` and `/<slug>/billing/*`.
- `lib/web-auth.ts` + `app/auth/{sign-in,callback,sign-out}`: GitHub (or Google) sign-in on weft.zip with PKCE in a
  cookie. The callback stamps `last_login_at` and `login_count`. `/login` uses it when deployed.
- `lib/teams.ts`: the gate. `teamAccess(slug)` answers ok / signed-out / denied / unconfigured (a missing workspace and
  a non-member get the same "denied", so membership can't be probed); `requireTeam(slug)` redirects to `/login` or
  404s. `currentWorkspaceSlug()` reads `profiles.current_org_id` and heals a stale pointer. `inviteMailer()` sends
  invites through Resend (`RESEND_API_KEY`, from `Weft <team@weft.zip>`). No `"use cache"`: plain queries per request.
- `lib/team-actions.ts`: the server actions: invite (or add straight in when the address already has an account),
  change role, remove or leave, revoke an invite. Each re-checks the role on the server, and none leaves a workspace
  without an owner.
- `app/team` (redirect to the current workspace), `app/[orgSlug]/layout.tsx` (the workspace shell: name, switcher,
  Team and Billing), `app/[orgSlug]/team`, `app/invite/[token]` (a Join button, so link-preview bots can't accept an
  invite), `components/team/*`.

## Roles

| role | can |
|---|---|
| owner | everything, including other owners and the workspace itself |
| admin | invite, remove and re-role members and admins; manage billing |
| member | see the roster; leave |

## Setup on the deployment

- Apply `20261013170000_teams.sql` (the Supabase drawer's Migrate, or `supabase db push`).
- Supabase Auth → URL configuration: add `https://weft.zip/auth/callback` to the redirect URLs.
- Vercel env: `SUPABASE_SECRET_KEY` and `RESEND_API_KEY` (both already used by other routes);
  `NEXT_PUBLIC_SITE_URL` is optional (`next.config.ts` defaults it to `https://weft.zip`).
