# 020: saving a share failed with "permission denied for table cloud_shares"

**Date:** 2026-10-17 · **Severity:** High (the Share dialog could never save a mode, so no link could be made)

## Symptom

In **Share…**, picking a mode showed `permission denied for table cloud_shares` and the card stayed private. Reading the share worked; only writing failed.

## Cause

`cloud_shares.password_hash` is deliberately not selectable by clients: the migration grants `select` on every column except it, and the dialog reads `has_password` (a generated column) instead. `setCardShare` saved with a Supabase `upsert`, which is `INSERT … ON CONFLICT DO UPDATE SET … = excluded.…`. Postgres needs `select` on every column the statement reads, and the `DO UPDATE` reads `excluded.password_hash`. The whole statement was refused, even with the hash null.

```ts
// before
await client.from("cloud_shares").upsert(row, { onConflict: "org_id,card_id" }).select("id, mode, has_password").single();
```

Checked against the production database as the `authenticated` role: the upsert is refused, a plain `update` and a plain `insert` pass the column grants (the row-level policy then decides who).

## Fix

Update the existing row, or insert a new one, asking nothing back, then read the state through the columns clients may see:

```ts
// after
const { error } = existing
  ? await shares.update(change).eq("org_id", orgId).eq("card_id", cardId)
  : await shares.insert({ ...change, id: newShareId(), org_id: orgId, card_id: cardId });
check(error);
return stateOf(await readShare(client, orgId, cardId));
```

**Key rule:** on a table with column-level grants, never upsert; an `ON CONFLICT DO UPDATE` reads every column it names, including the ones the role can't select.

**Files:** `lib/card-share.ts`, `lib/card-share.test.ts` (the fake client now records `insert` and `update`, and no upsert).
