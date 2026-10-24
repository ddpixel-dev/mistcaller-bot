-- Owner decision 2026-10-24 (ADR 0031): the first create form asks for the gear tier, and the final form starts with it.
-- The slot-card draft carries it between the two forms.
alter table slot_draft add column gear_tier text;
