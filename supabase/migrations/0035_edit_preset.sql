-- FR-078 (ADR 0049): the creation card remembers which preset it is editing. No foreign key: a preset deleted during the
-- edit must not turn the edit into a new preset, so the save finds it gone and says so.
alter table slot_draft add column editing_preset_id uuid;
