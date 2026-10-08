-- The owner's Ping players button works once per content (owner decision 2026-10-08), so it cannot be used to spam.
alter table content add column pinged_at timestamptz;
