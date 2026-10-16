# 017: the deployed Weft 500'd after admin pages used `force-dynamic` under `cacheComponents`

**Date:** 2026-10-16 · **Severity:** Critical (the production build errored, weft.zip stopped rolling forward)

## Symptom

After the admin pages shipped to `main`, every subsequent Vercel production build errored with:

```
Route segment config "dynamic" is not compatible with `nextConfig.cacheComponents`. Please remove it.
> Build error occurred
Error: Turbopack build failed with 2 errors:
./app/(admin)/admin/settings/page.tsx:10:14
./app/(admin)/admin/users/page.tsx:12:14
```

The board was unreachable on `weft.zip` for the duration: the previous production build (12h old) was still aliased, but no new deploys were promoted. Other agents' pushes during the window also failed to build, leaving the codebase in a state where every new commit triggered a `● Error` deploy.

## Cause

The two admin pages had `export const dynamic = "force-dynamic"` as a route segment config:

```tsx
// app/(admin)/admin/users/page.tsx (before)
export const metadata: Metadata = { title: "Weft admin — Users" };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const { user } = await requireSuperAdminWeft();
  return <UsersClient session={adminSessionFrom(user)} />;
}
```

Next 16's `cacheComponents` (set in `next.config.ts`) turns each route into a cached component. The `dynamic` route segment config is one of the ones it doesn't allow — it assumes every page opts in to caching unless it does something uncacheable (an `await` on a request-scoped value, `connection()` to opt in, etc.).

## Why it was hard to find

- The build error is from Turbopack, but the *Vercel* CLI surfaces only `Command "pnpm run build" exited with 1` — the real error lives in `vercel inspect <deploy> --logs`.
- The local `pnpm run build` failed with the *same* error, but only when the working tree is clean of untracked WIP (other agents' half-finished files pulled the error message off in another direction).
- The error doesn't name a config file, only the offending page — so the rule is hidden in `next.config.ts`'s `cacheComponents: true`.

Found by running `vercel inspect weft-fjltrfl42-fastmonitor.vercel.app --logs` and reading the build phase output.

## Fix

Remove the `force-dynamic` line from both pages. They're already dynamic — they `await` the server gate, and the settings page also calls `await connection()` to opt in to per-request rendering:

```tsx
// app/(admin)/admin/users/page.tsx (after)
export const metadata: Metadata = { title: "Weft admin — Users" };
// (no `dynamic` — the `await requireSuperAdminWeft()` makes it dynamic)
```

```tsx
// app/(admin)/admin/settings/page.tsx (after)
export const metadata: Metadata = { title: "Weft admin — Settings" };
// (no `dynamic` — the `await connection()` opts it in)
```

Pushed as `f8aa47f`. The next build completed in 44s; the new deployment is now aliased to `weft.zip`.

## Key rule

Don't set route segment configs that `nextConfig.cacheComponents` disallows (`force-dynamic`, `revalidate`, `runtime = "edge"`). The async server gate already opts the page in. If the build fails on a route segment config, check `next.config.ts` first and remove the line — the page is dynamic by virtue of awaiting something request-scoped.

## Files involved

- `app/(admin)/admin/users/page.tsx` (one line removed)
- `app/(admin)/admin/settings/page.tsx` (one line removed)
