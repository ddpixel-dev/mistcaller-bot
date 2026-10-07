-- Guided steps v2: the member types how many of each role (Tank, Healer, Support, DPS) up front.
alter table slot_draft add column counts jsonb;
