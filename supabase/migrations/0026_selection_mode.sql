-- Owner request 2026-11-06 (FR-058, ADR 0035): content where the host picks the party. Signing up becomes an application
-- (status 'applied') that holds no seat; what the player applied for is kept in fill_roles and fill_slots, like a fill's
-- choices. Applying for one position is fill_slots with that slot.
alter table content add column selection boolean not null default false;
alter table slot_draft add column selection boolean not null default false;

alter table signup drop constraint signup_status_check;
alter table signup add constraint signup_status_check check (status in ('signed', 'waitlist', 'fill', 'applied'));
