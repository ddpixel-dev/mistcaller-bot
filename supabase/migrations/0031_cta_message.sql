-- FR-069, ADR 0044: the message whose content is copied under every CTA, as a link to the channel and message id.
create table cta_message (
  guild_id text primary key,
  channel_id text not null,
  message_id text not null,
  updated_at timestamptz not null default now()
);

alter table cta_message enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on cta_message from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on cta_message from authenticated;
  end if;
end $$;
