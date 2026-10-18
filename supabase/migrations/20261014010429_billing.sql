-- @aimhuge/billing v0.5.0 schema, copied into Weft's migrations. The package's two SQL files are appended
-- verbatim below in order (0001 then 0002). They hold subscriptions, invoices, payment methods, billing
-- profiles, the audit log, webhook idempotency, credit grants and the usage ledger. The Pro plan's Puku
-- tokens are metered in org_usage_charges under the meter 'puku_tokens'. Every table is RLS-on with no
-- policies, so only the deployed Weft's service role reaches them; reads and writes go through the
-- deployed Weft's own gate. docs/architecture/billing.md.
--
-- Adaptations from the package: one, at the end (Weft revokes the default table grants, as our other migrations do). Weft's profiles.email exists (20261011165940_profiles.sql); orgs
-- and org_memberships exist (20261013170000_teams.sql); the package's 0001 sets updated_at via column
-- default only (no trigger), so private.touch_updated_at is not needed here. The package's 0002 sets
-- search_path on org_usage_total as 'public', matching Weft's convention; every create and revoke/grant
-- is kept.

-- ────────────────────────────────────────────────────────────────────────────
-- @aimhuge/billing 0001 (start)
-- ────────────────────────────────────────────────────────────────────────────

-- @aimhuge/billing 0001 — subscriptions, invoices, payment methods, profiles,
-- the audit log and webhook idempotency.
--
-- Copy into an app's supabase/migrations under a new timestamp (see the
-- package README); `create ... if not exists` makes it a no-op where the
-- tables already exist (DeckCP, which these were extracted from).
--
-- Everything here MIRRORS the payment provider's state. `provider` +
-- `provider_*_id` say which upstream object a row reflects; the mock and
-- Stripe write the same rows, so reads never change.
--
-- Money is integer minor units (cents). Metered usage is micros, in 0002.
--
-- `plan` is free text: each app's TypeScript catalog is the vocabulary, and an
-- unknown value reads as the free plan. An app may add its own check
-- constraint (DeckCP: free | pro | team).
--
-- Service-role-only: RLS on, no policies. Reads and writes go through the
-- app's own gate, and mutations additionally require owner/admin there.
--
-- Assumes the app has public.orgs(id uuid), public.org_memberships(org_id,
-- user_id, role, created_at) and public.profiles(id, email) — the shared
-- workspace model.

-- ── Subscriptions ───────────────────────────────────────────────────────────
-- One row per org, created lazily on first billing read (an org with no row is
-- free — see ensureSubscription). PK on org_id, not a surrogate id: an org has
-- exactly one live subscription, and making that a constraint rather than a
-- convention means a double-submitted checkout upserts instead of duplicating.
create table if not exists public.org_subscriptions (
  org_id                uuid primary key references public.orgs(id) on delete cascade,

  plan                  text not null default 'free',
  -- Provider-neutral lifecycle. 'incomplete' is the checkout-started-but-not-
  -- finished state; 'past_due' is a failed renewal that hasn't been given up on.
  status                text not null default 'active'
                          check (status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete')),
  billing_interval      text not null default 'monthly'
                          check (billing_interval in ('monthly', 'yearly')),

  -- What's BILLED, which is not the same as how many members exist. Members can
  -- exceed seats (the UI flags it); seats never auto-shrink on a member leaving.
  seats                 integer not null default 1 check (seats >= 1),
  -- Per-seat, per-interval price at the time of purchase. Frozen on the row so a
  -- later price change in the catalog can't retroactively alter what a customer
  -- agreed to pay.
  unit_amount_cents     integer not null default 0 check (unit_amount_cents >= 0),
  currency              text not null default 'usd',

  current_period_start  timestamptz not null default now(),
  current_period_end    timestamptz not null default (now() + interval '1 month'),
  -- Cancel at the end of the paid period rather than immediately: the customer
  -- keeps what they paid for. `canceled_at` is when they ASKED, not when access
  -- ends — that's current_period_end.
  cancel_at_period_end  boolean not null default false,
  canceled_at           timestamptz,
  trial_end             timestamptz,

  provider              text not null default 'mock',
  provider_customer_id      text,
  provider_subscription_id  text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.org_subscriptions is
  'Mirror of the payment provider''s subscription for an org. One row per org; absent row means the app''s free plan.';

create index if not exists org_subscriptions_status_idx
  on public.org_subscriptions (status);
-- Renewal sweeps ask "which subscriptions lapsed?" — a period-end scan.
create index if not exists org_subscriptions_period_end_idx
  on public.org_subscriptions (current_period_end);

alter table public.org_subscriptions enable row level security;

-- ── Billing profile ─────────────────────────────────────────────────────────
-- Who the invoice is addressed to. Deliberately separate from the subscription:
-- finance edits this (and it appears on every invoice PDF) without touching
-- anything that affects what the org is charged.
create table if not exists public.org_billing_profiles (
  org_id          uuid primary key references public.orgs(id) on delete cascade,
  -- Where receipts go. Null = fall back to the org owner's account email;
  -- resolved at send time, not copied here, so it tracks an owner change.
  billing_email   text,
  company_name    text,
  -- Free text, not validated: VAT/GST/ABN/EIN formats differ per country and a
  -- regex here would reject a legitimate customer. The provider validates.
  tax_id          text,
  address_line1   text,
  address_line2   text,
  city            text,
  region          text,
  postal_code     text,
  -- ISO 3166-1 alpha-2, uppercase. Enforced in code (COUNTRIES in
  -- @aimhuge/billing) so adding a country isn't a migration.
  country         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.org_billing_profiles is
  'Invoice-addressee details per org. Separate from org_subscriptions so editing it can never change what is charged.';

alter table public.org_billing_profiles enable row level security;

-- ── Payment methods ─────────────────────────────────────────────────────────
-- Card METADATA only. There is no column here that could hold a PAN, CVC, or
-- expiry-plus-number pair, and that is the point: the full number never reaches
-- this application. The mock provider accepts only published test numbers and
-- keeps just what a receipt needs; a real provider hands back the same shape
-- from a token exchange that happens in the browser.
create table if not exists public.org_payment_methods (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  brand         text not null,                        -- 'visa' | 'mastercard' | …
  last4         text not null check (last4 ~ '^[0-9]{4}$'),
  exp_month     integer not null check (exp_month between 1 and 12),
  exp_year      integer not null check (exp_year between 2000 and 2100),
  -- Cardholder name as printed. Nullable — not every method has one.
  holder_name   text,
  is_default    boolean not null default false,

  provider                  text not null default 'mock',
  provider_payment_method_id text,

  created_at    timestamptz not null default now()
);

comment on table public.org_payment_methods is
  'Card metadata (brand/last4/expiry) only — never a full card number. Mirrors the provider''s tokenized payment methods.';

create index if not exists org_payment_methods_org_idx
  on public.org_payment_methods (org_id, created_at desc);

-- At most one default per org, enforced by the database rather than by the
-- promote-then-demote code path — an interleaved second request can't leave two.
create unique index if not exists org_payment_methods_one_default_idx
  on public.org_payment_methods (org_id)
  where is_default;

alter table public.org_payment_methods enable row level security;

-- ── Invoices ─────────────────────────────────────────────────────────────────
-- Immutable once issued. Line items live in `lines` jsonb rather than a child
-- table: they are written once, always read whole with the invoice, and their
-- shape is the provider's, not ours — a normalized schema would have to be
-- migrated every time a provider adds a field. See InvoiceLine in
-- @aimhuge/billing for the contract.
create table if not exists public.org_invoices (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id) on delete cascade,

  -- Human-facing sequential-ish identifier ("DCP-2026-0007"). Unique across all
  -- orgs so it can be quoted in a support thread without an org to disambiguate.
  number            text not null unique,
  status            text not null default 'open'
                      check (status in ('draft', 'open', 'paid', 'void', 'uncollectible')),

  currency          text not null default 'usd',
  subtotal_cents    integer not null default 0,
  tax_cents         integer not null default 0,
  -- May be NEGATIVE: a downgrade whose proration credit exceeds the new charge
  -- issues a credit note. Deliberately unconstrained for that reason.
  total_cents       integer not null default 0,
  amount_paid_cents integer not null default 0,

  period_start      timestamptz,
  period_end        timestamptz,
  issued_at         timestamptz not null default now(),
  paid_at           timestamptz,
  due_at            timestamptz,

  description       text,
  lines             jsonb not null default '[]'::jsonb,

  provider            text not null default 'mock',
  provider_invoice_id text,
  -- A real provider hosts the receipt and the PDF; the mock renders its own at
  -- /[orgSlug]/billing/invoices/[number], so the column is null for mock rows.
  hosted_url        text,
  pdf_url           text,

  created_at        timestamptz not null default now()
);

comment on table public.org_invoices is
  'Issued invoices and credit notes. Immutable after issue. total_cents may be negative (downgrade credit). Amounts are frozen at issue and never recomputed from the plan catalog.';

create index if not exists org_invoices_org_issued_idx
  on public.org_invoices (org_id, issued_at desc);
create index if not exists org_invoices_status_idx
  on public.org_invoices (org_id, status);

alter table public.org_invoices enable row level security;

-- ── Billing audit log ───────────────────────────────────────────────────────
-- Append-only. Answers "who changed this org's plan, when, and to what" — the
-- question every billing support thread opens with, and the one the subscription
-- row alone can't answer because it only holds the current state.
create table if not exists public.org_billing_events (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  -- 'subscription.created' | 'subscription.updated' | 'subscription.canceled' |
  -- 'subscription.resumed' | 'invoice.paid' | 'payment_method.attached' | …
  kind          text not null,
  -- Denormalized, and nullable for provider-initiated events (a renewal has no
  -- actor). Kept as text so the trail survives the user row being deleted.
  actor_email   text,
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

comment on table public.org_billing_events is
  'Append-only billing audit trail. actor_email is null for provider-initiated events (renewals, dunning).';

create index if not exists org_billing_events_org_created_idx
  on public.org_billing_events (org_id, created_at desc);

alter table public.org_billing_events enable row level security;

-- ── Stripe safety: idempotency and mirror keys ──────────────────────────────
-- ── Webhook idempotency ─────────────────────────────────────────────────────
-- Stripe delivers at-least-once and retries for up to three days on any
-- non-2xx. Without this table a retried `invoice.paid` writes a second invoice,
-- and the customer sees they were billed twice for the period they were billed
-- for once.
--
-- The event id is the PK, so recording an event and refusing a duplicate are
-- the same operation: insert, and a unique violation MEANS "already handled".
-- No read-then-write, so two concurrent deliveries of the same event can't both
-- observe "not yet processed" and both proceed.
create table if not exists public.billing_webhook_events (
  -- Stripe's `evt_…`. Provider-scoped by prefix in practice, and the provider
  -- column keeps it honest if a second webhook source ever lands here.
  id            text primary key,
  provider      text not null default 'stripe',
  type          text not null,
  -- Nullable: some events (a customer created outside any org) resolve to no
  -- org, and we still want the idempotency record.
  org_id        uuid references public.orgs(id) on delete set null,
  -- When handling failed. A row with an error is a row worth alerting on, and
  -- keeping it means the retry is still recognised as the same event.
  error         text,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz
);

comment on table public.billing_webhook_events is
  'Idempotency ledger for provider webhooks. PK on the provider event id, so a retried delivery is a unique violation rather than a duplicate write.';

create index if not exists billing_webhook_events_received_idx
  on public.billing_webhook_events (received_at desc);
-- "Which events failed and need a look" — the only query that matters at 3am.
create index if not exists billing_webhook_events_error_idx
  on public.billing_webhook_events (received_at desc)
  where error is not null;

alter table public.billing_webhook_events enable row level security;

-- ── Mirror keys ─────────────────────────────────────────────────────────────

-- A webhook arrives knowing only `cus_…`; this is how it finds the org. Without
-- it, every subscription event is a sequential scan of org_subscriptions.
create index if not exists org_subscriptions_provider_customer_idx
  on public.org_subscriptions (provider_customer_id)
  where provider_customer_id is not null;

-- The invoice mirror's real identity. `number` is already unique, but a Stripe
-- invoice's number can change (a draft finalizes, a number gets reassigned),
-- whereas its id never does — so the id is what an upsert must key on.
-- Partial, because mock invoices carry no provider id and must not collide on
-- a shared NULL.
create unique index if not exists org_invoices_provider_invoice_idx
  on public.org_invoices (provider, provider_invoice_id)
  where provider_invoice_id is not null;

-- Same reasoning for cards: `pm_…` is the identity, and re-syncing a customer's
-- payment methods must update the existing rows rather than accumulate copies.
create unique index if not exists org_payment_methods_provider_idx
  on public.org_payment_methods (org_id, provider_payment_method_id)
  where provider_payment_method_id is not null;

-- ── Provider vocabulary ─────────────────────────────────────────────────────
-- The `provider` columns were free text with a 'mock' default. Close the
-- vocabulary now that a second one exists, so a typo in an adapter can't write
-- rows that no reader will ever match.
alter table public.org_subscriptions
  drop constraint if exists org_subscriptions_provider_check;
alter table public.org_subscriptions
  add constraint org_subscriptions_provider_check check (provider in ('mock', 'stripe'));

alter table public.org_invoices
  drop constraint if exists org_invoices_provider_check;
alter table public.org_invoices
  add constraint org_invoices_provider_check check (provider in ('mock', 'stripe'));

alter table public.org_payment_methods
  drop constraint if exists org_payment_methods_provider_check;
alter table public.org_payment_methods
  add constraint org_payment_methods_provider_check check (provider in ('mock', 'stripe'));

-- ────────────────────────────────────────────────────────────────────────────
-- @aimhuge/billing 0001 (end)
-- ────────────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────────────
-- @aimhuge/billing 0002 (start)
-- ────────────────────────────────────────────────────────────────────────────

-- @aimhuge/billing 0002 — the metered-usage ledger.
--
-- Metered charges against a plan's per-period allowance (BlastCP's image
-- credit; any app's next meter). A meter is just a name; the plan catalog in
-- TypeScript says how much of it each plan grants and whether that resets.
--
-- MONEY IS INTEGER MICRO-DOLLARS (1e-6 USD) on a money meter. A cheap
-- generated image retails at $0.00317; rounded to cents, three of BlastCP's
-- four image models would be free. A count meter (tokens, renders) stores the
-- count in the same `amount` column — the unit belongs to the meter.
--
-- THE BALANCE IS DERIVED, NOT COUNTED: allowance + unexpired grants − usage
-- in the window, read on every check. A counter drifts from the rows that
-- justify it. The sum runs here, in org_usage_total, because a client-side sum
-- would stop at PostgREST's row cap and undercount a busy org.

-- ── Charges ─────────────────────────────────────────────────────────────────
create table if not exists public.org_usage_charges (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  meter        text not null check (meter ~ '^[a-z][a-z0-9_]{0,40}$'),
  -- What the ORG was charged, in the meter's unit.
  amount       bigint not null check (amount >= 0),
  -- What it cost US, when known. Stored beside the price so the margin is on
  -- every row and a later markup change can't rewrite past charges.
  cost_micros  bigint check (cost_micros >= 0),
  -- What the charge was for, e.g. ('media', <uuid>). Deliberately NOT a
  -- foreign key: deleting the thing must not erase the fact it was paid for,
  -- or a balance could be refilled by deleting history.
  ref_type     text,
  ref_id       text,
  metadata     jsonb not null default '{}'::jsonb,
  created_by   uuid references auth.users(id) on delete set null,
  created_via  text not null default 'app' check (created_via in ('app', 'mcp', 'system')),
  created_at   timestamptz not null default now()
);

comment on table public.org_usage_charges is
  'Metered usage ledger. One row per charge, amount in the meter''s unit (micros for money meters). The balance is derived from these rows, never stored.';

-- The balance query: one org, one meter, since the window start.
create index if not exists org_usage_charges_org_meter_time_idx
  on public.org_usage_charges (org_id, meter, created_at desc);

alter table public.org_usage_charges enable row level security;

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Credit ADDED on top of the plan's allowance: a trial extension, an apology,
-- a bought bundle. Not a replacement for the allowance — that comes from the
-- catalog, so changing a plan's allowance changes it for every subscriber at
-- once. A grant counts while unexpired; a one-off top-up for this period is a
-- grant that expires at the period end.
create table if not exists public.org_credit_grants (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id) on delete cascade,
  meter             text not null check (meter ~ '^[a-z][a-z0-9_]{0,40}$'),
  amount            bigint not null check (amount > 0),
  reason            text,
  granted_by_email  text,
  expires_at        timestamptz,
  created_at        timestamptz not null default now()
);

comment on table public.org_credit_grants is
  'Credit added on top of a plan''s metered allowance. Counts while expires_at is null or in the future.';

create index if not exists org_credit_grants_org_meter_idx
  on public.org_credit_grants (org_id, meter);

alter table public.org_credit_grants enable row level security;

-- ── The sum ─────────────────────────────────────────────────────────────────
-- Usage on one meter since `p_since` (null = all time, for allowances that
-- never reset). bigint in, bigint out — no float anywhere near money.
create or replace function public.org_usage_total(p_org_id uuid, p_meter text, p_since timestamptz)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(amount), 0)::bigint
    from public.org_usage_charges
   where org_id = p_org_id
     and meter = p_meter
     and (p_since is null or created_at >= p_since);
$$;

-- Service role only, like the tables it reads. A balance an authenticated
-- client could read directly is one it could try to probe across orgs.
revoke all on function public.org_usage_total(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.org_usage_total(uuid, text, timestamptz) to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- @aimhuge/billing 0002 (end)
-- ────────────────────────────────────────────────────────────────────────────
-- Weft's addition: RLS with no policies already keeps the publishable key out, but like our other migrations we also
-- take back the table privileges Supabase grants by default, so a policy added later by mistake can't open these up.
revoke all on public.org_subscriptions, public.org_billing_profiles, public.org_payment_methods, public.org_invoices,
  public.org_billing_events, public.billing_webhook_events, public.org_usage_charges, public.org_credit_grants
  from anon, authenticated;
