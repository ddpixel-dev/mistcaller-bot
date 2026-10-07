-- The type of content is now chosen in the create panel (PvP or PvE), so a guided draft remembers it.
alter table slot_draft add column type text;
