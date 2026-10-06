create table guild_settings (
  guild_id text primary key,
  officer_role_id text,
  pvp_forum_id text not null,
  pve_forum_id text not null,
  daily_cap int not null default 5,
  created_at timestamptz not null default now()
);

create table content (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  thread_id text not null,
  message_id text,
  type text not null check (type in ('pvp', 'pve')),
  title text,
  notes text,
  starts_at timestamptz,
  min_tier smallint,
  min_enchant smallint,
  max_tier smallint,
  max_enchant smallint,
  has_loot boolean not null default false,
  status text not null default 'open' check (status in ('open', 'locked', 'cancelled', 'done')),
  loot_result_posted_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);

create table slot (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  content_id uuid not null references content (id) on delete cascade,
  position smallint not null,
  role text,
  weapon text,
  unique (content_id, position)
);

create table signup (
  guild_id text not null,
  content_id uuid not null references content (id) on delete cascade,
  user_id text not null,
  slot_id uuid references slot (id),
  status text not null default 'signed' check (status in ('signed', 'waitlist')),
  joined_at timestamptz not null default now(),
  primary key (content_id, user_id)
);

create unique index signup_one_signed_per_slot on signup (slot_id) where status = 'signed';

create table vote (
  guild_id text not null,
  content_id uuid not null references content (id) on delete cascade,
  user_id text not null,
  choice text not null check (choice in ('split', 'regear')),
  voted_at timestamptz not null default now(),
  primary key (content_id, user_id)
);

alter table guild_settings enable row level security;
alter table content enable row level security;
alter table slot enable row level security;
alter table signup enable row level security;
alter table vote enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on guild_settings, content, slot, signup, vote from anon;
    alter default privileges in schema public revoke all on tables from anon;
    alter default privileges in schema public revoke all on sequences from anon;
    alter default privileges in schema public revoke all on functions from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on guild_settings, content, slot, signup, vote from authenticated;
    alter default privileges in schema public revoke all on tables from authenticated;
    alter default privileges in schema public revoke all on sequences from authenticated;
    alter default privileges in schema public revoke all on functions from authenticated;
  end if;
end $$;
