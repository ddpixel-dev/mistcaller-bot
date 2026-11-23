-- FR-076 (ADR 0049): a content's slots are written by role or by weapon, fixed at creation. A weapon slot has no role.
alter table content add column slot_mode text not null default 'role' check (slot_mode in ('role', 'weapon'));
alter table slot_draft add column slot_mode text not null default 'role' check (slot_mode in ('role', 'weapon'));
