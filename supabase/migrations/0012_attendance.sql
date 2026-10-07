-- FR-014: attendance. A manager marks who attended; those not picked become no-shows only when the form is
-- submitted, and unmarked members are never counted as no-shows. Every table carries a guild id (NFR-004).
create table attendance (
  guild_id text not null,
  content_id uuid not null references content (id) on delete cascade,
  user_id text not null,
  status text not null check (status in ('attended', 'no_show')),
  marked_by text not null,
  marked_at timestamptz not null default now(),
  primary key (content_id, user_id)
);
create index attendance_member_idx on attendance (guild_id, user_id);

alter table attendance enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on attendance from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on attendance from authenticated;
  end if;
end $$;

-- attendance_dm_sent_at: the owner was sent the form (5 minutes after the start). attendance_submitted_at: the owner
-- submitted it. report_posted_at: the report went into the content's post. ended_at: a manager ended the content.
alter table content add column attendance_dm_sent_at timestamptz;
alter table content add column attendance_submitted_at timestamptz;
alter table content add column report_posted_at timestamptz;
alter table content add column ended_at timestamptz;
