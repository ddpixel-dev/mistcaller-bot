-- Guided steps v3: the type is chosen in the create panel, each slot card keeps a pending role, weapon and
-- duty, and the draft remembers which slot card it is on. (count, role, weapon exist from 0005; counts from 0007.)
alter table slot_draft add column type text;
alter table slot_draft add column duty text;
alter table slot_draft add column step smallint not null default 0;
