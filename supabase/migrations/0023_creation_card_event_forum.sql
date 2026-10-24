-- Owner decisions 2026-10-24 (ADR 0032): the creation card keeps everything typed in the member's draft, and event
-- forums get a launcher post from which the bot creates each event's post.
alter table slot_draft add column title text;
alter table slot_draft add column start_text text;
alter table slot_draft add column notes text;
alter table slot_draft add column slots_text text;
alter table slot_draft add column target_forum_id text;

-- Content whose post the bot created: its post is renamed when the title changes.
alter table content add column own_post boolean not null default false;

create table event_forum (
  guild_id text not null,
  forum_id text not null,
  type text check (type in ('pvp', 'pve')), -- null: any type
  launcher_thread_id text,
  created_at timestamptz not null default now(),
  primary key (guild_id, forum_id)
);
create unique index event_forum_launcher on event_forum (launcher_thread_id);

alter table event_forum enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on event_forum from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on event_forum from authenticated;
  end if;
end $$;
