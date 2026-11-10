-- FR-070: a call to arms may have two parties of up to 20 players, each with its own roster message.
-- slot.position stays unique per content (party 1 first, then party 2). Existing rows are party 1.
alter table content add column party_count smallint not null default 1 check (party_count in (1, 2));
alter table slot add column party smallint not null default 1 check (party in (1, 2));
alter table signup add column party smallint not null default 1 check (party in (1, 2));
alter table slot_draft add column parties smallint not null default 1;
alter table slot_draft add column slots2 jsonb not null default '[]'::jsonb;
alter table slot_draft add column slots2_text text;

-- The message of each party after the first. Party 1 stays in content.message_id.
create table content_message (
  guild_id text not null,
  content_id uuid not null references content (id) on delete cascade,
  party smallint not null check (party in (1, 2)),
  message_id text not null,
  primary key (content_id, party)
);

alter table content_message enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on content_message from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on content_message from authenticated;
  end if;
end $$;
