-- FR-084 (ADR 0050): on a two-party card, Setup Slots fills one party at a time; this says which.
alter table slot_draft add column guided_party smallint not null default 1 check (guided_party in (1, 2));
