-- Setup redesign (owner decision 2026-10-08, ADR 0020): a server names any number of admin roles, and content is no
-- longer tied to two forums. The old single officer role is copied into the new table; the old columns stay unused.
create table guild_admin_role (
  guild_id text not null,
  role_id text not null,
  created_at timestamptz not null default now(),
  primary key (guild_id, role_id)
);

insert into guild_admin_role (guild_id, role_id)
select guild_id, officer_role_id from guild_settings where officer_role_id is not null
on conflict do nothing;

alter table guild_settings alter column pvp_forum_id drop not null;
alter table guild_settings alter column pve_forum_id drop not null;

alter table guild_admin_role enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on guild_admin_role from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on guild_admin_role from authenticated;
  end if;
end $$;
