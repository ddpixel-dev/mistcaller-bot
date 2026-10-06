# Content Roster Bot (working title)

## Product description

A Discord bot for an Albion Online guild. Members announce in-game content (PvP or PvE) as a post in a guild-managed forum. The bot turns each post into a live roster: the content time in UTC and in every viewer's local time, the gear tier, one row per position (role plus weapon), who has signed up, a waitlist, and a loot vote (split or regear) when the content has loot. After the content it records attendance and no-shows.

It solves manual roster tracking in forum posts and comments, and timezone confusion.

## Vision

The guild uses it every day and no one tracks a roster by hand. It starts as a single-guild tool and may later be published for other guilds, so every record is keyed by guild from the start.

## Users

- Content creator: any guild member. Posts content in a configured forum and manages it.
- Participant: any member. Signs up for a position, moves, leaves, votes on loot.
- Manager: the creator, a member with Manage Server, or a member with the guild's officer role. Edits, locks, cancels content and marks attendance.

## Features

### FT-001: Create content in a forum post
status: not started
phase: POC
priority: must
satisfies: FR-001, FR-002, FR-003, FR-004, FR-018

A member runs `/content create` inside a forum post. The bot posts the roster message with UTC and local time.

### FT-002: Sign up, move and leave
status: not started
phase: POC
priority: must
satisfies: FR-005, FR-006

A member picks a position from a menu to sign up, picks another to move, or presses Leave.

### FT-003: Waitlist
status: not started
phase: MVP
priority: must
satisfies: FR-007

A member can queue for a taken position and is promoted first-come first-served when it frees up.

### FT-004: Loot vote
status: not started
phase: POC
priority: must
satisfies: FR-008, FR-012, FR-013

Signed-up players vote split or regear. The vote closes 5 minutes before the start and the result is shown.

### FT-005: Manage content and permissions
status: not started
phase: MVP
priority: must
satisfies: FR-009, FR-010

Creator, server admins and the officer role can edit, lock and cancel content. Creation is capped per user.

### FT-006: Guild setup
status: not started
phase: MVP
priority: must
satisfies: FR-016

`/content setup` sets the officer role and the PvP and PvE forums. The POC uses a manually seeded settings row.

### FT-007: Reminders
status: not started
phase: MVP
priority: should
satisfies: FR-011

Signed-up players are pinged about 30 minutes before the start.

### FT-008: Upcoming content list
status: not started
phase: MVP
priority: should
satisfies: FR-015

`/content list` shows upcoming open content in the guild.

### FT-009: Attendance and no-show history
status: not started
phase: MVP
priority: should
satisfies: FR-014

A manager marks each signed-up player attended or no-show. Per-player history shows counts, with unmarked content shown separately.

### FT-010: Public publishing
status: not started
phase: later
priority: could
satisfies: NFR-006

Publish the bot for other guilds: global commands, install link, privacy note, delete-my-data path.

### FT-011: Templates, recurring content, calendar export
status: not started
phase: later
priority: could
satisfies: FR-003

Saved rosters, repeating content and an ICS export. Not planned yet.

## Functional requirements

### FR-001: Command namespace
status: accepted
The bot shall expose the slash command `/content` with the subcommands `create`, `edit`, `lock`, `cancel`, `list`, `attendance`, `history` and `setup`.

### FR-002: Creation location and content type
status: accepted
`/content create` shall work only inside a post of a configured forum. The content type (PvP or PvE) is taken from the parent forum: one forum per type. Elsewhere it shall reply privately with an explanation.

### FR-003: Creation input
status: accepted
Creation shall collect a title, a start time in UTC, a gear tier, a list of slots and optional notes, plus a loot option on the command. The tier is one value (`T5.3`) or a range (`T5.3-T7.0`). Each slot is one line of the form `Role - Weapon`, with no repetition shorthand, and there shall be at most 20 slots. Invalid input and start times in the past shall be rejected with an example of the correct format.

### FR-004: Roster message
status: accepted
The roster message shall show the start time as plain UTC text and as Discord timestamps (full local time and relative time), the tier or range, whether there is loot, and one row per slot with the signed-up player or "open".

### FR-005: Sign up, move, leave
status: accepted
A member shall sign up for a slot through a select menu, move by selecting another slot, and leave with a Leave button. A member holds at most one active entry per content. The menu is hidden or rejects input once the content is locked.

### FR-006: Atomic slot claim
status: accepted
At most one member shall hold a slot. When two members claim the same slot at the same moment, exactly one succeeds and the other is told the slot is taken.

### FR-007: Waitlist
status: accepted
A member shall be able to join the waitlist of a taken slot. When that slot frees up, the first waitlisted member is promoted and pinged.

### FR-008: Loot vote
status: accepted
For content with loot, signed-up members (not waitlisted) shall vote split or regear, one vote each, changeable until the cutoff. The message shows counts only. Votes are rejected from 5 minutes before the start. The result is then shown, and a tie is reported as a tie.

### FR-009: Management rights
status: accepted
The creator, any member with Manage Server, and any member with the guild's officer role shall be able to edit, lock and cancel content and mark attendance. Others are refused. Changing the start time pings signed-up members and resets the reminder.

### FR-010: Creation cap
status: accepted
A member shall create at most 5 content posts in any rolling 24 hours, counting cancelled ones. The limit is a guild setting with a default of 5.

### FR-011: Reminders
status: accepted
Signed-up members shall be pinged once, about 30 minutes before the start. Sending shall be idempotent.

### FR-012: Auto-lock
status: accepted
Content shall lock automatically at its start time.

### FR-013: Scheduled jobs
status: accepted
A GitHub Actions workflow shall call the protected cron route every 5 minutes. The route sends due reminders, auto-locks, posts vote results and marks finished content done.

### FR-014: Attendance and history
status: accepted
A manager shall mark each signed-up member attended or no-show. Unmarked members shall be shown as "not recorded" and never counted as no-shows. `/content history @member` shows attended, no-show and not-recorded counts.

### FR-015: Upcoming list
status: accepted
`/content list` shall list upcoming open content of the guild with links.

### FR-016: Guild setup
status: accepted
`/content setup`, restricted to Manage Server, shall set the officer role, the PvP forum and the PvE forum, and optionally the creation cap.

### FR-017: Roster recovery
status: proposed
If the roster message was deleted, the next interaction or scheduled job shall recreate it from the database.

### FR-018: Safe text
status: accepted
User-supplied text shall be escaped, and every bot message shall restrict allowed mentions so text such as `@everyone` cannot ping.

## Non-functional requirements

### NFR-001: Security
status: accepted
Every Discord request shall be signature-verified before parsing. The cron route shall require a secret header. Secrets live only in environment variables. All tables have row-level security enabled with no policies. Queries are parameterized. The bot has no Administrator permission and no privileged intents. Authorization uses only the verified user and guild.

### NFR-002: Responsiveness
status: accepted
Every interaction shall be acknowledged within 3 seconds, including after a cold start.

### NFR-003: Cost
status: accepted
Run on free tiers only (Vercel Hobby, Supabase free, GitHub Actions). No paid service without the owner's approval.

### NFR-004: Data model
status: accepted
Every table shall carry a guild id. Times are stored in UTC.

### NFR-005: Reliability
status: accepted
State lives in the database, never in memory. Scheduled actions are idempotent. The vote cutoff is enforced when the vote is cast, not only by the schedule.

### NFR-006: Privacy
status: proposed
Store only Discord IDs and event data. A privacy note and a delete-my-data path are required before publishing for other guilds. Details are open (see open questions).

### NFR-007: Maintainability
status: accepted
Domain logic (parsers, roster and vote rules) shall be pure, with no Discord or database imports, and unit-tested.

## Phases

### POC

Goal: prove that the free hosting stack carries the core loop: create content in a forum post, sign up and leave under concurrency, vote on loot, and run scheduled jobs.

Validated when every check below has a recorded passing result. MVP work does not start before that.

#### CHK-001: Signed endpoint
validates: NFR-001
check: Discord's signed test request is accepted when the endpoint URL is saved in the developer portal, and a request with a bad signature gets 401.
status: not started
result:

#### CHK-002: Create and time rendering
validates: FT-001
check: `/content create` inside a PvP forum post posts a roster showing UTC text and the local time, which two viewers in different timezones read correctly.
status: not started
result:

#### CHK-003: Concurrent signup
validates: FT-002
check: Sign up, move and leave work. Two simultaneous clicks on one slot give exactly one winner.
status: not started
result:

#### CHK-004: Cold-start acknowledgement
validates: NFR-002
check: After 30 minutes idle, the first command is acknowledged within 3 seconds.
status: not started
result:

#### CHK-005: Scheduled vote result
validates: FT-004
check: The GitHub Actions job posts the vote result after the T-5 cutoff. The measured delay between cutoff and result is recorded, along with whether it came before the start time.
status: not started
result:

#### CHK-006: Database closed to anon
validates: NFR-001
check: The Supabase anon key cannot read any table.
status: not started
result:

#### CHK-007: Supabase stays active
validates: NFR-003
check: After 7 days, the Supabase project has not been paused, with the scheduled job as the only regular activity if the bot is unused.
status: not started
result:

### MVP

Exit criteria: the guild runs its daily content through the bot for a week with all must and should features working and no manual roster tracking.

- Must: FT-003 (waitlist), FT-005 (management and cap), FT-006 (setup) complete the core loop once the POC items FT-001, FT-002 and FT-004 are validated.
- Should: FT-007 reminders, FT-008 list, FT-009 attendance and history, as requested by the owner.
- Could: none beyond the later items.
- Deferred: FT-010 public publishing and FT-011 templates, recurring content and export.

## Plans

Build the POC first (M0 to M3), with the deployed endpoint first and the scheduled job last, then the MVP (M4 and M5). Details: [roadmap](docs/plan/roadmap.md), [milestones](docs/plan/milestones.md), [tasks](docs/plan/tasks.md).

## Out of scope

- Any Albion game data lookups (builds, items, prices). A link to the owner's separate hub is a later idea.
- A web dashboard or login. All interaction is inside Discord.
- A gateway-connected bot. The bot is HTTP-only and shows as offline in the member list.
- Voice features, loot tracking and anything touching the game client.

## Current state

Phase: POC
Last updated: 2026-10-06
Next step: owner reviews these documents, then the implementation plan for M0 to M3 is written.

| Item | Status | Note |
|---|---|---|
| FT-001 | not started | POC |
| FT-002 | not started | POC |
| FT-004 | not started | POC |
| FT-003, FT-005, FT-006 | not started | MVP |
| FT-007, FT-008, FT-009 | not started | MVP |
| FT-010, FT-011 | not started | later |
| CHK-001 to CHK-007 | not started | |
