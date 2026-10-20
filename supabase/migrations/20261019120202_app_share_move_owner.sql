-- A mini app link can move between its owners (weft.zip/@you/apps/<slug> ↔ weft.zip/<team>/apps/<slug>), which
-- changes its workspace, org_id (docs/architecture/mini-app-hosting.md). The update policy from
-- 20261018131912_app_shares.sql already checks the result: the row stays the sharer's own and the sharer must be a
-- member of the workspace it lands in. Only the column grant was missing, so Postgres refused the whole update.
grant update (org_id) on public.cloud_app_shares to authenticated;
