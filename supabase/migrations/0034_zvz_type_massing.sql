-- ADR 0048: ZvZ is a content type of its own, and every content may say where the party masses (FR-074).
alter table content drop constraint content_type_check;
alter table content add constraint content_type_check check (type in ('pvp', 'pve', 'pvx', 'zvz'));
-- The type check of event_forum has a generated name (0028 renamed the table), so it is found, not named.
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'event_forum'::regclass and contype = 'c' loop
    execute format('alter table event_forum drop constraint %I', c);
  end loop;
end $$;
alter table event_forum add constraint event_forum_type_check check (type in ('pvp', 'pve', 'pvx', 'zvz'));

alter table content add column massing_at text;
alter table slot_draft add column massing text;
