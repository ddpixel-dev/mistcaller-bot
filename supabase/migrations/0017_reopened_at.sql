-- Owner decision 2026-10-09 (ADR 0024): a roster no longer locks at its start, and ended content can be reopened.
-- A reopened content gets a fresh 4-hour auto-end window counted from this time, not from its start.
alter table content add column reopened_at timestamptz;
