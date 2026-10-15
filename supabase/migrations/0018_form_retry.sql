-- Owner decision 2026-10-09 (ADR 0025): when the create or edit form has mistakes, the bot lists them all and offers a
-- "Fix and retry" button that reopens the form with the text the member typed. This keeps that text for an hour
-- (one row per member and post; the scheduled job purges old rows).
create table form_retry (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  user_id text not null,
  thread_id text not null,
  form_id text not null,
  fields jsonb not null,
  created_at timestamptz not null default now()
);
create unique index form_retry_one_per_user_thread on form_retry (guild_id, thread_id, user_id);

alter table form_retry enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on form_retry from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on form_retry from authenticated;
  end if;
end $$;
