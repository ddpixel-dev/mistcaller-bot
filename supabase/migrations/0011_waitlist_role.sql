-- FR-007: a waitlisted member waits for a role (owner decision 2026-10-08: per role).
-- signup.status = 'waitlist' rows have no slot and carry the role they wait for.
alter table signup add column wait_role text;
create index signup_waitlist_idx on signup (content_id, joined_at) where status = 'waitlist';
