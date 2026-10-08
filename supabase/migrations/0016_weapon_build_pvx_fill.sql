-- Owner decisions 2026-10-08 (docs/plan/2026-10-08-optional-weapon-build-channel-pvx-fill.md):
-- a player's own weapon for a role-only slot, a build channel per event, a third content type (PvX),
-- and a Fill signup status (a signed-up member without a position).
alter table signup add column chosen_weapon text;

alter table content add column build_channel_id text;

alter table content drop constraint content_type_check;
alter table content add constraint content_type_check check (type in ('pvp', 'pve', 'pvx'));

alter table signup drop constraint signup_status_check;
alter table signup add constraint signup_status_check check (status in ('signed', 'waitlist', 'fill'));

-- The guided steps keep the build channel chosen at the start of creation.
alter table slot_draft add column build_channel_id text;
