-- ADR 0047: a CTA is one roster message in the CTA channel, with optional Bombers (a list with no positions).
-- Bombers are signup rows with status 'bomber'; content.bombers is the cap, null means no Bombers.
alter table content add column roster_channel_id text;
alter table content add column bombers smallint check (bombers between 1 and 20);
alter table slot_draft add column bombers smallint check (bombers between 1 and 20);

alter table signup drop constraint signup_status_check;
alter table signup add constraint signup_status_check check (status in ('signed', 'waitlist', 'fill', 'applied', 'bomber'));

-- A preset made for a CTA has slots in party 2; mark those so the CTA preset list can find them.
alter table slot_preset add column cta boolean not null default false;
update slot_preset set cta = true where slots @> '[{"party": 2}]';
