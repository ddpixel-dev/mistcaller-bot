-- Owner request 2026-11-06 (FR-061): a server can choose a channel where each release's changelog is posted, and a
-- record of which version was posted to which server, so a release script run twice never posts twice.
create table changelog_channel (
  guild_id text primary key,
  channel_id text not null,
  updated_at timestamptz not null default now()
);

create table changelog_post (
  guild_id text not null,
  version text not null,
  posted_at timestamptz not null default now(),
  primary key (guild_id, version)
);

alter table changelog_channel enable row level security;
alter table changelog_post enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on changelog_channel from anon;
    revoke all on changelog_post from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on changelog_channel from authenticated;
    revoke all on changelog_post from authenticated;
  end if;
end $$;
