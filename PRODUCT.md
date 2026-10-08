# Content Roster Bot (working title)

## Product description

A Discord bot for an Albion Online guild. Members announce in-game content (PvP or PvE) as a post in a guild-managed forum. The bot turns each post into a live roster: the content time in UTC and in every viewer's local time, the gear tier, one row per position (role plus weapon), who has signed up, a waitlist, and a loot vote (split or regear) when the content has loot. After the content it records attendance and no-shows.

It solves manual roster tracking in forum posts and comments, and timezone confusion.

## Vision

The guild uses it every day and no one tracks a roster by hand. It starts as a single-guild tool and may later be published for other guilds, so every record is keyed by guild from the start.

## Users

- Content creator: any guild member. Posts content in any channel, thread or forum post and manages it.
- Participant: any member. Signs up for a position, moves, leaves, votes on loot.
- Manager: the creator, a member with Manage Server, or a member with one of the server's admin roles. Edits, locks, cancels content and marks attendance.

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
status: built (needs migration 0011)
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
status: edit, cancel, lock and unlock built (FR-020, FR-021, FR-009); creation cap dropped
phase: MVP
priority: must
satisfies: FR-009, FR-010

Creator, server admins and the admin roles can edit, lock and cancel content. Anyone can create; there is no cap (FR-010 dropped).

### FT-006: Guild setup
status: built (re-register commands after release)
phase: MVP
priority: must
satisfies: FR-016

`/content setup` chooses the admin roles with a role picker (ADR 0020). No forums or server id are configured.

### FT-007: Reminders
status: built (needs migration 0010)
phase: MVP
priority: should
satisfies: FR-011

Signed-up players are pinged about 30 minutes before the start.

### FT-008: Upcoming content list
status: built
phase: MVP
priority: should
satisfies: FR-015

`/content list` shows upcoming open content in the guild.

### FT-009: Attendance and no-show history
status: built (needs migration 0012)
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

### FT-012: One content per forum post
status: built, awaiting live migration
phase: MVP
priority: must
satisfies: FR-019

A forum post holds at most one active content, so rosters cannot be duplicated by accident.

### FT-013: Fantasy roster style
status: built (art URLs pending the owner)
phase: MVP
priority: should
satisfies: FR-022

The roster message gets the Medieval Banner look in the Lines layout (decided 2026-10-07): colors per content type, role icons, a roster-fill bar and dividers.

### FT-014: Content kinds
status: built (needs migration 0003 on the live database)
phase: MVP
priority: should
satisfies: FR-023

Different kinds of PvP and PvE content, each with its own label and color.

### FT-016: Duties
status: built (needs migrations 0006 and 0008)
phase: MVP
priority: should
satisfies: FR-027

A slot carries a duty (Caller, Scout, Rat), set while defining the slots or later by a manager; it appears on the roster line.

### FT-015: Slot builder and presets
status: all three phases built (presets, weapon data and `/content weapon`, guided steps); guided steps need migration 0005 (see docs/plan/2026-10-07-ft-015-slot-builder-design.md)
phase: MVP
priority: should
satisfies: FR-024, FR-025, FR-026

Guided steps and saved presets next to typed lines, with weapon search from game data.

## Functional requirements

### FR-001: Command namespace
status: accepted
The bot shall expose the slash command `/content` with the subcommands `create`, `edit`, `lock`, `unlock`, `cancel`, `end`, `list`, `attendance`, `history`, `setup`, `preset`, `weapon`, `slot`, `duty` and `me`.

### FR-002: Creation location and content type
status: accepted
`/content create` shall work in any text channel, announcement channel, thread or forum post of a server (changed 2026-10-08, ADR 0020; it was limited to two configured forums). The content type (PvP or PvE) is chosen in the create panel (ADR 0016). Elsewhere (a direct message, a voice channel, a category) it shall reply privately with an explanation. The content belongs to the place where the command ran (FR-019). Before anything is saved, the bot checks the install type and its own permissions that Discord sends with the interaction, and explains the problem instead of a vague failure: it is not added to the server (only to an account), or it lacks View Channel and Send Messages (Send Messages in Threads for threads and forum posts) in that place.

### FR-003: Creation input
status: accepted
Creation shall collect a title, a start time in UTC, a gear tier, a list of slots and optional notes, with no command options: `/content create` opens a private panel with menus for the kind (categories of the forum's type), the loot vote and an optional preset, then a Continue button opens the form (owner request 2026-10-07). The type (PvP or PvE) is chosen in the panel. The **Gear Tier** is free text of up to 80 characters, shown as typed, for example `Weapon T7.1 - Gear T4.3` (owner decision 2026-10-08, replacing the fixed `T5.3` or `T5.3-T7.0` format). Each slot is one line of the form `Role - Weapon`, optionally followed by a duty in brackets (`Tank - Great Axe (Caller)`), with no repetition shorthand, and there shall be at most 20 slots. Invalid input and start times in the past shall be rejected with an example of the correct format.

### FR-004: Roster message
status: accepted
The roster message shall show its title as a level-1 heading, the largest text Discord allows (owner request 2026-10-08), and the start time as plain UTC text and as Discord timestamps (local time and relative time), the gear tier or range on its own line (with a gear icon), the loot vote on its own line (with the tally and closing time while open, and the result on the same line after the cutoff), and the slots grouped under a heading per role, such as `🛡️ Tank · 1/1` (owner decision 2026-10-08, layout E, ADR 0021). Each row reads `n. WeaponIcon Weapon - DutyIcon Duty · Sworn: Player` (or `Open`), where the weapon icon is the actual icon (ADR 0017) and the duty appears only when set; position numbers do not change. The header labels (Type, Gear tier, Loot vote, UTC, Your time) are followed by a measured number of en spaces so the values start in one column; Discord's font is proportional, so this is accurate to a few pixels, not exact.

### FR-005: Sign up, move, leave
status: accepted
A member shall sign up, or move, by picking from a menu that lists only the open positions, so a taken position disappears from it (owner decision 2026-10-07, ADR 0018). One shared **Leave** button sits under the roster for every party size: it is enabled while anyone is signed up and dimmed otherwise, and it only ever acts for a signed-up player (anyone else gets a private "You are not signed up"). Discord cannot enable a control for some viewers only. `/content me` opens a private panel with a Leave button of one's own. Every change updates the shared roster message. A member holds at most one active entry per content. Rosters posted before this layout keep their old look and no longer respond.

### FR-006: Atomic slot claim
status: accepted
At most one member shall hold a slot. When two members claim the same slot at the same moment, exactly one succeeds and the other is told the slot is taken.

### FR-007: Waitlist
status: accepted
When every position of a role is taken, a member shall be able to join the waitlist for that role, from a menu under the roster (owner decision 2026-10-08: the waitlist is per role). The roster lists the waitlist in join order with each member's role. When a position of a role frees up (the holder leaves or moves, or a position is added or renamed in an edit) while the content is open, the first member waiting for that role is seated in it, in the same database change so nobody can slip in between, and is pinged in the content's post. A member who holds a position cannot wait; a waiting member who takes an open position, or presses Leave, leaves the waitlist; changing the role waited for puts the member at the back. No promotion happens once the content is locked or started.

### FR-008: Loot vote
status: accepted
For content with loot, signed-up members (not waitlisted) shall vote split or regear, one vote each, changeable until the cutoff. The message shows counts only. Votes are rejected from 5 minutes before the start. The result is then shown, and a tie is reported as a tie.

### FR-009: Management rights
status: accepted
The creator, any member with Manage Server or Administrator, and any member with one of the server's admin roles (ADR 0020) shall be able to edit, lock and cancel content and mark attendance. Others are refused. `/content lock` closes signups and moves before the start (players can still leave, and the reminder is still sent); the start locks it anyway. `/content unlock` reopens a roster locked early, before the start, and seats the waitlist in positions freed while it was locked (owner request 2026-10-08). Changing the start time pings signed-up members and resets the reminder.

### FR-010: Creation cap
status: dropped (owner decision 2026-10-08, ADR 0020; not built)
A member shall create at most 5 content posts in any rolling 24 hours, counting cancelled ones. The limit is a guild setting with a default of 5.

### FR-011: Reminders
status: accepted
The content's owner shall be able to remind the signed-up players with a **Ping players** button on the roster (owner decision 2026-10-08, replacing the automatic reminder because the scheduler ran only every few hours, see Q1). Only the creator can use it, and only **once per content**: the first use is recorded (`content.pinged_at`, migration 0013) and the button is dimmed on the roster so nobody spams the players; if nobody could be reached the use is given back. It sends a private message to every signed-up player (not the owner, not the waitlist) with the start time and a link to the roster, plus a labelled copy to the owner so they can see what players get (owner decision 2026-10-08), and tells the owner how many were reached and who could not be (closed private messages). With nobody else signed up, only the owner's copy is sent and the one use is kept. The automatic 30-minute reminder is built but switched off; setting `AUTO_REMINDERS=on` enables it once the scheduler is reliable. When enabled it pings the signed-up players once in the content's post about 30 minutes before the start, claimed in the database before sending, reset by a changed start time, and skipped for content created or edited inside the 30 minutes.

### FR-012: Auto-lock
status: accepted
Content shall lock automatically at its start time.

### FR-013: Scheduled jobs
status: accepted
An external free cron service (ADR 0019, owner decision 2026-10-08) shall call the protected cron route every few minutes; the GitHub Actions workflow remains as a slow fallback. The route sends due reminders, auto-locks, posts vote results, sends the attendance message and report, and ends content that nobody ended **4 hours after its start** (owner decision 2026-10-08): it becomes done and the roster shows it as concluded. Submitting the attendance form does not end content, because somebody can join late; only `/content end` or this 4-hour rule does. No message is posted in the thread for the automatic end, the same as for `/content end`.

### FR-014: Attendance and history
status: accepted
About 5 minutes after the start, the bot shall send the content's creator a **private message** with a button that opens the attendance form, for the creator to open whenever they can (owner decision 2026-10-08). If the private message cannot be sent, a short note with the command goes in the content's post. A manager (the creator, Manage Server or an admin role) can also open the form privately with `/content attendance` once the content has started. The form lists the signed-up players by their server names; the manager picks everyone who attended and presses **Submit**, which records everyone not picked as a no-show; **Save and finish later** keeps the picks and records nobody as a no-show. Members who are not marked are shown as "not recorded" and are never counted as no-shows. **The report is posted in the content's post only when the owner submits the form** (not when the content ends), listing attended and no-show players without pinging them; a failed post is retried. `/content history @member` shows attended, no-show and not-recorded counts, where not recorded means finished content the member was signed up for with no mark.

### FR-028: End content
status: accepted
The creator, a member with Manage Server, or an admin role shall be able to end content that has started with `/content end` (owner decision 2026-10-08: the command only, no button). The content becomes done, the roster shows it as concluded, and its controls are dimmed. Ending does not post the attendance report; that waits for the attendance form to be submitted (FR-014).

### FR-029: Help and owner tips
status: accepted
`/content help` shall answer privately with what the bot does and every command, so that a new member or owner can learn it in one message (owner request 2026-10-08). A live roster (open or locked) shall end, below its buttons, with small tips for the owner: `/content edit` changes the event, do not forget `/content end` when it is over, and `/content help` for more. Finished and cancelled rosters show no tips.

### FR-015: Upcoming list
status: accepted
`/content list` shall show the server's upcoming content (open, or locked early and not yet started; not cancelled, ended or already started), soonest first, up to 15, each with its start (relative), title, type and category, how many positions are filled, a lock mark when locked, and a link to its roster message. The reply is private.

### FR-016: Guild setup
status: accepted
`/content setup`, restricted to Manage Server or Administrator, shall open a private role picker listing the server's roles, with the current admin roles preselected, and save a change at once (up to 10 roles, never @everyone; changed 2026-10-08, ADR 0020, replacing the officer role, the two forums and the cap). The commands are registered globally, so no server id is configured.

### FR-017: Roster recovery
status: proposed
If the roster message was deleted, the next interaction or scheduled job shall recreate it from the database.

### FR-018: Safe text
status: accepted
User-supplied text shall be escaped, and every bot message shall restrict allowed mentions so text such as `@everyone` cannot ping.

### FR-019: One active content per post
status: accepted
A forum post shall hold at most one content whose status is `open` or `locked`. A new content may be created in a post only after the previous one was cancelled. A post whose content is `done` cannot take a new one. The database enforces this, so two simultaneous creates cannot both succeed, and the second creator gets a clear private message.

### FR-020: Edit content
status: accepted
The creator, a member with Manage Server, or a member with an admin role shall be able to edit a content's title, start time, tier, notes and loot toggle, add slots, and rename slots. A slot can be removed only while it is empty. Changing the start time pings the signed-up members and resets the reminder. Editing is allowed only while the content is open and before its start. It is done with `/content edit` inside the post: a form shows the current title, start, tier, slots and notes, and an optional `loot-vote` option changes the loot-vote toggle. Slot lines map to positions: a changed line renames that slot, extra lines add slots, and dropping trailing lines removes them only if nobody holds them. The reminder reset applies once reminders exist (FT-007). The roster message is re-rendered after every edit.

### FR-021: Cancel content
status: accepted
The same managers shall be able to cancel an open or locked content with `/content cancel`, after a private confirmation step. Cancelling sets the status to `cancelled`, re-renders the roster as cancelled with all buttons disabled, and pings the signed-up members.

### FR-022: Medieval Banner roster style
status: accepted
The roster message shall use the Medieval Banner theme chosen by the owner on 2026-10-07: royal blue and gold container colours by content type and category, scroll and fleur-de-lis marks in the title, an icon per role, a roster-fill bar, double-line rules and the words "company" and "sworn". Since the roster became a Components V2 message (ADR 0018) there is no embed: the colour bar is the container's accent colour and the text lives in text blocks within Discord's 4,000-character limit. Status shows as a text line (closed, cancelled, concluded) and cancelled or finished content is greyed with every control dimmed. The owner supplies the bot icon and banner art; the theme file `src/render/theme.ts` is where they will be set. No third-party game art is used without the owner's decision (ADR 0017 for the weapon icons).

### FR-023: Content kinds
status: accepted
Each content shall have a category inside its type (a PvP category or a PvE category), chosen in the create panel after the type (the word "kind" was renamed "category" on 2026-10-07), shown on the roster and used for its label and color. The kind is optional and defaults to Other. The list is fixed in code (ADR 0010): PvP has ZvZ, Small-scale, Gank Squad, Bomb Squad (added 2026-10-08), Hellgate, Faction Warfare, Crystal League, Arena, Skirmish, Training and Other; PvE has Group dungeon, Avalonian dungeon, Mists, Corrupted dungeon, World boss, Fame farming and Other. A per-server editable list was dropped from the MVP.

### FR-024: Slot definition modes
status: accepted
An officer shall be able to define the slots in three ways: typing the lines (the final form), guided steps, or a saved preset. In the create panel, Continue goes straight to the guided steps (owner decisions 2026-10-07): a form asks "How many players needed?" (one whole number, 1 to 20, with validation), then one card per slot offers four lists with placeholders, **Role** (Tank, Healer, Support, DPS), **Weapon class** (Sword, Axe, Hammer, Mace, Spear, Dagger, Quarterstaff, Bow, Crossbow, Gloves, Fire, Frost, Holy, Arcane, Cursed and Nature Staff, Shapeshifter, Off-hand), **Weapon** (the weapons of the chosen class) and **Duty** (Caller, Scout, Rat, optional; deselect to clear), with the buttons Next (Finish on the last), Back, Same as previous, Fill the rest and Cancel (Change number is on the first and last screens). Next saves the slot. The Back button on the first card returns to the create panel. `/content slot role weapon duty` fills the current card in one command, with the weapon typed and picked from an autocomplete list. Discord select menus cannot have a search box and the owner asked for no pop-up search, so typing a name uses that command. A chosen preset skips the cards and opens the filled form. Progress is kept in the database for an hour. The steps end by opening the usual create form with the slots filled in. Every mode produces the same slot list, at most 20 slots, so the roster and signup rules do not change.

### FR-025: Saved presets
status: accepted
An officer shall be able to save the slots defined in the typed-lines mode or the guided-steps mode as a named preset for the server, and later start a content from a preset and adjust it. Only members with Manage Server or an admin role may save and delete presets, and a server holds at most 25 (ADR 0012).

### FR-026: Weapon list and icons
status: accepted
Guided steps shall let the officer find a weapon through a weapon list taken from the `ao-bin-dumps` game data (ADR 0009, 0015): by weapon class then weapon, or by typing with live search in `/content slot`. The icon of each weapon, from Albion's render service, is uploaded once as an application emoji (ADR 0017, owner decision 2026-10-07, rights accepted by the owner) and shown inline beside the weapon name in the roster, in menus and on buttons. A weapon without an icon (a new weapon, or Black Hands, which the render service lacks) shows its name only. `/content weapon` and the guided card still show the linked thumbnail (ADR 0013).

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
status: done
result: 2026-10-06 passed. Discord accepted `https://mistcaller-bot.vercel.app/api/discord`; unsigned POSTs to it got 401 "invalid request signature" in 12 of 12 repeated probes after the alias settled. Two live deploy problems were fixed on the way (TypeScript 7 pin, `.ts` import specifiers).

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
status: done
result: 2026-10-06 passed. A positive control (`/auth/v1/health`) confirmed the project URL, then all six tables (`guild_settings`, `content`, `slot`, `signup`, `vote`, `schema_migrations`) answered HTTP 401 with PostgREST code 42501 (permission denied). A first run the same day was a false pass (URL contained a path); `scripts/check-anon.ts` now normalizes the URL and runs the positive control.

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

Phase: MVP, release 0.17.0 in preparation (gear tier as free text, Gank and Bomb Squad, `/content help`, owner tips, server-only commands, clear install and permission errors) after 0.16.0 live (content nobody ended is ended 4 hours after its start; 0.15.1: roster title as a large heading; 0.15.0: roster rows grouped by role, measured header columns, owner's copy on Ping; 0.14.0 added single-use Ping, any-channel creation, admin roles, global commands; migrations through 0014) (owner accepted the POC on 2026-10-06, see docs/decisions/0007-poc-accepted-with-open-checks.md)
Last updated: 2026-10-08
Next step: owner tests 0.16.0 (automatic end after 4 hours, bigger title, layout E, header columns, Ping copy, the automatic reminder, `/content setup` role picker, creation in other channels). Then roster recovery (FR-017), the remaining live checks and the banner art.

| Item | Status | Note |
|---|---|---|
| FT-001, FT-002, FT-004 | built, live | Live checks CHK-002, CHK-003, CHK-005 still to record |
| FT-012 one content per post | live (0.2.0) | |
| FT-005 edit and cancel | live (0.2.0) | Lock and the creation cap are not built |
| FT-013 banner style | live, art pending | The 0.4.0 headers and ANSI block were reverted in 0.5.0 |
| FT-014 content kinds | live (0.4.0) | Chosen in the create panel since 0.5.0 |
| FT-006 `/content setup` | admin-role picker in 0.14.0 | Replaces forums, officer role and cap (ADR 0020); global commands |
| FT-015 slot builder and presets | built; 0.7.0 reworks the guided steps | Role numbers, `/content slot` search, Continue choice; needs migration 0007 |
| FT-016 duties | in 0.7.0 | `/content duty`; needs migration 0006 |
| FT-003 waitlist, FT-007 reminders, FT-008 list, FT-009 attendance | not started | MVP |
| FT-010, FT-011 | not started | later |
| CHK-001, CHK-006 | done | 2026-10-06 |
| CHK-002 to CHK-005, CHK-007 | in progress | Cron workflow green since 2026-10-07; clicks fast after the dub1 region fix |
