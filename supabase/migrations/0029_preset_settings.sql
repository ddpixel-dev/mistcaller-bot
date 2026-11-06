-- Owner request 2026-11-07 (ADR 0039): a preset keeps the whole creation card (type, category, loot vote, sign-up mode,
-- title, gear tier, notes, build link), not only the slots. Older presets have no settings and fill the slots only.
alter table slot_preset add column settings jsonb;
