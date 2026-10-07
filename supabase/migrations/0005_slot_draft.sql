-- FR-024: progress of the guided slot steps, kept in the database (no state in memory, NFR-005).
-- One draft per member per post. The scheduled job purges drafts older than an hour.
create table slot_draft (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  user_id text not null,
  thread_id text not null,
  loot boolean not null default false,
  kind text not null default 'other',
  count smallint,
  slots jsonb not null default '[]'::jsonb,
  role text,
  weapon text,
  query text,
  created_at timestamptz not null default now()
);
create unique index slot_draft_one_per_user_thread on slot_draft (guild_id, thread_id, user_id);

alter table slot_draft enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on slot_draft from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on slot_draft from authenticated;
  end if;
end $$;
