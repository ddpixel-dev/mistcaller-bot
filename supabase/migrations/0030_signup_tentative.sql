-- Owner request 2026-11-08 (FR-067): a signed-up player can mark themselves tentative. The flag is on the sign-up row, which
-- every move between seat, fill, applicants and waitlist updates in place, so it follows the player; leaving deletes the row.
alter table signup add column tentative boolean not null default false;
