-- League emails (lib/league-mail*.ts, app/api/league/emails): a daily run on the deployed Weft tells each builder about
-- their league: a welcome on day one, a Thursday and a Sunday nudge when a move is in reach, and Monday's results.
-- The run reads league_weeks and profiles with the service key; this adds the opt-out and the log that keeps any
-- email from going out twice. docs/architecture/gamification.md.

-- Off from the email's unsubscribe link (app/api/league/unsubscribe), or by the builder on their own profile row.
alter table public.profiles add column league_emails boolean not null default true;

-- One row per email sent: claimed before the send (a duplicate key means another run has it) and dropped again if
-- Resend refuses it, so a failed send is retried by the next run.
create table public.league_emails (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- welcome, midweek, final or results (lib/league-mail.ts LeagueMailKind).
  kind    text not null check (kind in ('welcome', 'midweek', 'final', 'results')),
  -- The Monday of the league week the email is about.
  week    date not null check (extract(isodow from week) = 1),
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, week)
);

-- No policies: only the service key reads or writes it.
alter table public.league_emails enable row level security;
