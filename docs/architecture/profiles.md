# Public profiles

Every Weft account has a public page at `weft.zip/@username`. Anyone can open it without signing in.

## What it shows

- The picture and name from your GitHub sign-in (`profiles.avatar_url`, `profiles.name`), or the first letter of your username when there's no picture.
- `@username` and **Wefter since** (the month your account was created).
- A **GitHub** link, to the login you signed in with (read from Auth's `user_metadata.user_name`, since the username may carry a `-2` or come from your email).
- **Public threads**: up to 24 of your share links set to *public* (`cloud_shares.mode = 'public'`, `created_by` = you), newest first, each a link to its `/s/<id>` viewer. A link whose card was deleted is left out.

It never shows your email, your workspace, a card's folder or any private, email or password share.

## Usernames

`supabase/migrations/20261017161000_profile_usernames.sql` adds `profiles.username`: unique, lowercase, shaped like a GitHub
login (`^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$`). `private.username_for(seed)` slugifies the GitHub login (or the email's local
part), skips a short reserved list (`admin`, `weft`, `support`…) and adds `-2`, `-3`… on a clash. The trigger
`on_auth_user_created_username` sets it after the profile row exists (triggers fire in name order). Accounts made before the
migration were backfilled oldest first, so the earliest sign-up keeps the bare login. Usernames can't be changed yet.

## Route

An App Router folder can't start with `@`, because that marks a parallel-route slot. So `next.config.ts` rewrites `/@:username` to
`/u/:username` in `beforeFiles`, ahead of the `[orgSlug]` segment. `/u/<username>` works too. A workspace can never be named `u`,
because `private.org_slug_for` skips slugs shorter than 2 characters.

`app/u/[username]/page.tsx` awaits its params inside a `<Suspense>` (cacheComponents) and calls `loadPublicProfile`
(`lib/public-profile.ts`). That reads through the service client, since `profiles` has no anon policy, selects only the public
columns, and returns `null` (so the page 404s) for a handle that can't be a username or isn't taken. A handle like `@Alex` or `%40alex` is lowercased first, so a link
built from a GitHub login with capitals (the league standings' `username`) still lands. The body is `components/profile/PublicProfileView.tsx`, a server component on
`team.css`'s tokens plus `components/profile/profile.css`. Off weft.zip (`isDeployed()` false), the page shows a note instead.

## Not yet

- Editing your username or adding a bio.
- An opt-out (a profile is always public), and an opt-out for listing a public share.
- A per-profile `<title>` and Open Graph image: the metadata is static, like `/s/[id]`'s.
- A link from the workspace header or the desktop's account menu to your own profile.
