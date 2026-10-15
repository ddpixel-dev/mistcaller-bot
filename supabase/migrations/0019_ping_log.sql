-- Owner decision 2026-10-15 (FR-038): the Ping players button reaches each player once, not once for the whole
-- content, so late joiners can be pinged later. One row per player pinged.
create table ping_log (
  content_id uuid not null references content (id) on delete cascade,
  user_id text not null,
  pinged_at timestamptz not null default now(),
  primary key (content_id, user_id)
);

-- Content pinged before this release: everyone on its roster now counts as pinged.
insert into ping_log (content_id, user_id, pinged_at)
select c.id, su.user_id, c.pinged_at
from content c join signup su on su.content_id = c.id and su.status in ('signed', 'fill')
where c.pinged_at is not null
on conflict do nothing;

alter table ping_log enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on ping_log from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on ping_log from authenticated;
  end if;
end $$;
