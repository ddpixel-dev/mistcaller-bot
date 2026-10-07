-- The guided card picks a weapon class first, then a weapon of that class (replaces the typed search form).
alter table slot_draft add column weapon_class text;
