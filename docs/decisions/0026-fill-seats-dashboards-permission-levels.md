---
title: Fills hold seats; calendar and statistics dashboards; permission levels
type: decision
status: accepted
date: 2026-10-15
tags: [roster, signup, dashboards, permissions]
satisfies: [FR-037, FR-038, FR-039, FR-040, FR-041, FR-042, FR-043, FR-044, FR-045]
---

# 0026: Fills hold seats; calendar and statistics dashboards; permission levels

## Context
Eleven owner requests of 2026-10-15, planned in `docs/plan/2026-10-15-release-0.21.md` and released together as 0.21.0. Item 4 (the Change number bug) is not in this release: it needs a repro from the owner.

## Decision
- **Fills hold seats (FR-040).** Open positions minus fills are the positions anyone can still pick. The party count is seated players plus `min(fills, open)`. Claims take the content row `for update` so two simultaneous claims cannot both take the last free seat. A fill beyond the free positions is standby. The waitlist is promoted under the same rule, and when every free position is held the waitlist menu offers every role.
- **Ping once per player (FR-038).** `ping_log` (migration 0019) replaces the once-per-content flag; the old `content.pinged_at` stays, unused, and migration 0019 backfills the current players of already-pinged content.
- **Weapon emojis at tier 8 (FR-039).** New emojis carry a `w8_` prefix and are uploaded next to the old `w_` ones, so rosters never lose an icon during the switch. The old ones are removed later with `scripts/sync-emoji.ts --remove-old`, once old roster messages have been re-rendered.
- **Remove player (FR-042)** reuses the Assign fill pattern (a private panel and a menu, authorised on every click). Buttons now continue in a second row after five.
- **Dashboards (FR-043, FR-044).** One table `dashboard` (migration 0020) and one refresh engine for both kinds. The refresh locks the dashboard row, compares a digest that leaves out the "Updated" time, and edits, posts or deletes only messages the bot recorded. A failed refresh saves nothing and is retried. Schedule-changing commands refresh the calendar inside a 1.5-second guard; sign-up counts and statistics wait for the scheduled job (statistics every 30 minutes). The calendar is a day-by-day agenda for the next 7 days.
- **Permission levels (FR-045).** Everyone, host (the content's creator) and admin, enforced in code. `history` of another member is admin only. No host role. Discord cannot hide single subcommands, so refusals explain themselves.
- **Prefilled start time (FR-037)** is the current UTC time plus one hour, to the minute.

## Consequences
- Migrations 0019 and 0020. Commands changed (re-register): `setup` options, the `history` description.
- A leaving player's sign-up is deleted, so statistics undercount players who left; the message says so.
- Dashboards depend on the bot having View Channel and Send Messages in the chosen channels; setup checks by posting once.
