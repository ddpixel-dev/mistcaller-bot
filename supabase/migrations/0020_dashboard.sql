-- Owner decision 2026-10-15 (FR-043, FR-044): a server can have a schedule channel and a statistics channel, each
-- holding message(s) the bot keeps up to date. One row per server and kind.
create table dashboard (
  guild_id text not null,
  kind text not null check (kind in ('schedule', 'statistics')),
  channel_id text not null,
  message_ids jsonb not null default '[]'::jsonb,
  digest text not null default '',
  updated_at timestamptz not null default now(),
  primary key (guild_id, kind)
);

alter table dashboard enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on dashboard from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on dashboard from authenticated;
  end if;
end $$;
