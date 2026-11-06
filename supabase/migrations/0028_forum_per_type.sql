-- Owner request 2026-11-06 (ADR 0037): an event forum is chosen per content type (PvP, PvE or PvX), with no "Any".
-- The same forum may serve several types, so the key is now (guild, type) and forum_id may repeat.
alter table event_forum rename to event_forum_old;
drop index event_forum_launcher;

create table event_forum (
  guild_id text not null,
  type text not null check (type in ('pvp', 'pve', 'pvx')),
  forum_id text not null,
  launcher_thread_id text,
  created_at timestamptz not null default now(),
  primary key (guild_id, type)
);

-- Keep what the old routing did: an exact type wins, then a forum for any type, then (PvX only) the first forum.
insert into event_forum (guild_id, type, forum_id, created_at)
select distinct on (guild_id, t) guild_id, t, forum_id, created_at
from (
  select f.guild_id, f.forum_id, f.created_at, v.t,
    case when v.t = 'pvx' then (case when f.type is null then 0 else 1 end) else (case when f.type = v.t then 0 else 1 end) end as rank
  from event_forum_old f
  cross join (values ('pvp'), ('pve'), ('pvx')) as v(t)
  where f.type = v.t or f.type is null or v.t = 'pvx'
) c
order by guild_id, t, rank, created_at;

-- An old launcher post id moves to one new row per forum, so scripts/remove-launchers.ts still finds it.
update event_forum n set launcher_thread_id = o.launcher_thread_id
from event_forum_old o
where o.launcher_thread_id is not null and o.guild_id = n.guild_id and o.forum_id = n.forum_id
  and n.type = (select min(m.type) from event_forum m where m.guild_id = n.guild_id and m.forum_id = n.forum_id);

drop table event_forum_old;
create unique index event_forum_launcher on event_forum (launcher_thread_id);
create index event_forum_forum on event_forum (guild_id, forum_id);

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
