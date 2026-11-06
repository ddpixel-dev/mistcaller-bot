-- Owner request 2026-11-06 (FR-057, ADR 0035): a fill says what they are willing to play. A fill who could not be seated
-- waits with these choices; both columns null means Any position. fill_slots holds slot ids, not position numbers, so
-- adding a position never changes what was asked for. Reserved seats are gone, so nothing else changes in the table.
alter table signup add column fill_roles text[];
alter table signup add column fill_slots uuid[];
