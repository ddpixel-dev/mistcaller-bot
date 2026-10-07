-- FR-025: saved slot presets, per guild, managed by Manage Server and the officer role (ADR 0012).
create table slot_preset (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  name text not null,
  slots jsonb not null,
  created_by text not null,
  created_at timestamptz not null default now()
);
create unique index slot_preset_name_per_guild on slot_preset (guild_id, lower(name));

alter table slot_preset enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on slot_preset from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on slot_preset from authenticated;
  end if;
end $$;
