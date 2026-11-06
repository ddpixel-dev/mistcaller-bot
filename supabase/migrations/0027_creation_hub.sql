-- Owner request 2026-11-06 (FR-059, FR-060, ADR 0036): the creation hub in the content-management channel.
-- A content may be a CTA (call to arms, posted in the CTA forum, created only by chosen roles) or blank (no roster).
alter table content add column cta boolean not null default false;
alter table content add column blank boolean not null default false;
alter table slot_draft add column cta boolean not null default false;

-- The forum where CTA posts are made. Each CTA is its own post, like any event (one content per post, FR-019).
create table cta_forum (
  guild_id text primary key,
  forum_id text not null,
  updated_at timestamptz not null default now()
);

-- Roles allowed to create CTA content, besides admins.
create table guild_cta_role (
  guild_id text not null,
  role_id text not null,
  created_at timestamptz not null default now(),
  primary key (guild_id, role_id)
);

alter table cta_forum enable row level security;
alter table guild_cta_role enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on cta_forum, guild_cta_role from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on cta_forum, guild_cta_role from authenticated;
  end if;
end $$;
