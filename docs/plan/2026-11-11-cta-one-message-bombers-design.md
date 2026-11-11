---
title: CTA in one message, Bombers, CTA presets, quiet pins
type: plan
status: accepted (owner approved 2026-11-11, "proceed, record decisions, plans, implement and release")
date: 2026-11-11
satisfies: [FR-070, FR-071, FR-072, FR-073]
---

# CTA in one message, Bombers, CTA presets, quiet pins

Seven owner requests of 2026-11-11, after testing 0.31.8. They change how a CTA is shown, not the party model: fill, waitlist, numbering and the party column of 0.31.8 (ADR 0044) stay.

## Guardrail check (docs/process/guardrails.md)

| ID | Verdict | Note |
|---|---|---|
| ADR 0044, FR-070 | supersedes (in part) | "One roster message per party" becomes one message for the whole CTA. Party model, fill and waitlist per party stay. |
| ADR 0036 (CTA in a channel with a thread) | changes | The announcement in the CTA channel **is** the roster now; the thread is started from it. The one-line announcement and its Roster button go for new CTAs. |
| FR-063 (roster pinned) | changes for CTA | A CTA roster is not pinned (it is the thread's starter message, which Discord cannot pin in the thread). Normal content rosters stay pinned. |
| FR-069, ADR 0045 | consistent | The forwarded CTA message is still posted in the thread and pinned. |
| ADR 0039 (presets) | changes | Presets are kept apart: CTA presets on the CTA card, normal presets on Plan Content. |
| NFR-001, FR-018 | constraint | Every message keeps `allowed_mentions: { parse: [] }`; content lookups use only the verified guild and channel. |
| NFR-002 | constraint | Create still answers within 3 seconds; it makes fewer Discord calls than 0.31.8. |
| NFR-005 | constraint | No state in memory. |

Phase: MVP, unlocked. No new dependency. One migration (0033).

## The requests and the decisions

1. **Delete "pinned a message" notices (FR-072).** After every pin the bot makes (a normal roster, the CTA message), it reads the last few messages of the channel, finds Discord's pin notice (message type 6) that refers to the pinned message, and deletes it. This needs Manage Messages; without it the notice stays and nothing else changes. Never fails the caller.
2. **Separate buttons on the CTA card.** **Details** holds title, start, gear tier, notes and the Bombers cap. **Slots** (one party) or **Party 1 slots** (two parties) opens the party 1 box; **Party 2 slots** and **Copy party 1** stay. Plan Content (normal content) is unchanged: its Details still holds the slots.
3. **One message for the whole CTA (ADR 0047).** The roster is posted in the CTA channel, and the thread is started from it, so Discord shows it in the channel and at the top of the thread. It is not pinned (owner decision A). The thread holds the forwarded CTA message (pinned) and the bot's later posts.
4. **Bombers (FR-071).** A CTA may have Bombers: a list with no positions, joined with a **💣 Bombers** button beside Leave and Tentative. It is chosen at creation with a cap from 1 to 20 typed in Details (empty = no Bombers), and can be changed in Edit details (never below the current number of bombers).
5. **One menu per party** in that message.
6. **CTA presets (FR-073).** A preset belongs to the card it was saved from: the CTA card lists only CTA presets, Plan Content only normal ones. Each kind has its own cap of 25.
7. **Parties menu wording.** Placeholder "How many parties?", options "👤 One Party" and "👥 Two Parties".

## The CTA message

```
## 📣 Raid | 12 Nov | 20:00 UTC        title, time, tier, notes (as today)
**Party 1 (14/20)**
1. Tank - @a …
**Party 2 (9/20)**                     only with two parties
**💣 Bombers (3/10):** @x · @y · @z      only when Bombers is on
🔁 Fill / 🕒 Waitlist / 📨 Applicants lines, per party

[ Party 1: pick an open position ▾ ]
[ Party 2: pick an open position ▾ ]
[ Party 1: join the waitlist ▾ ]        only if a role there is full
[ Party 2: join the waitlist ▾ ]
[🚪 Leave] [❓ Tentative] [💣 Bombers 3/10] [Split] [Regear]
[📣 Ping players] [🛠️ Manage]
```

- With one party and no Bombers, a CTA looks like a one-party roster of today (no "Party 1" heading), except that it is in the channel.
- **One place per CTA** (owner confirmed): a seat, a waitlist spot, a fill, an application, or Bombers. Picking something new moves the player out of the old place. Pressing Bombers while in Bombers says so privately ("You are in Bombers. Press Leave to leave.").
- Leave and Tentative are one button each for the whole CTA (a player holds one place). They act on that place.
- The Bombers button shows `Bombers n/cap` and is dimmed when full or when the CTA is not open. In selection mode Bombers still joins directly.
- Party 2's menus carry the `@2` suffix as in 0.31.8; the dispatcher already splits it.
- Text budget (4000): the existing order of cuts applies to the whole message: weapon icons first, then notes, then rows. Bombers mentions are cut at 600 characters like the waitlist line. Components: at most about 25 of Discord's 40.
- Normal content renders exactly as before (the snapshot test `tests/render/fixtures/oneParty.snapshot.json` stays byte-identical).

## Where it lives, and finding the CTA from a click

- `content.roster_channel_id` (new, null for every old row): the channel that holds the roster message when it is not the thread. For a new CTA it is the CTA channel, and `message_id` equals the thread id (a thread started from a message has that message's id).
- Every edit of a roster message uses `roster_channel_id ?? thread_id`. Every link to the roster uses the same channel.
- Clicks on the roster come with the CTA channel as the channel, not the thread. Host panels opened from it are private messages in that channel too. Today ten places look the content up by the channel (`getManageTarget(guild, channelId)`). They change to a lookup that takes the content id carried in the custom id and accepts it only when the content belongs to the verified guild and the channel is its thread or its roster channel (`getManageTargetFor`). A slash command in the CTA channel has no content id and keeps answering "use this inside the post"; in the thread it works as before.
- Editing the title or start renames the thread and re-renders the roster; the old announcement edit is done only for old CTAs that have one (`roster_channel_id` null and `cta` true).

## Creating a CTA

1. Post a placeholder message ("⏳ Creating the roster…", Components V2) in the CTA channel.
2. Start the thread from it, named with the post name (FR-068).
3. Save the content with `roster_channel_id` = the CTA channel and `message_id` = the placeholder id.
4. Edit the placeholder into the roster.
5. In parallel: the dashboard refresh, the forwarded CTA message (pinned, notice removed).
If 1 to 4 fail, everything made is removed (as today).

## Bombers in the host panels and elsewhere

- **Remove player:** with Bombers on, the party choice gets a third button **💣 Bombers**, listing the bombers.
- **Attendance:** the same third choice; Bombers counts like a party for "submitted" (an empty Bombers list counts as submitted).
- **Ping** includes bombers. **Leave** removes them. **Tentative** marks them (❓ after the name).
- **Assign, Add, Set weapon, Duty, Fill** do not apply to Bombers.
- The calendar total stays the party seats (`31/40`); Bombers are not counted there.
- Statistics count a bomber's attendance like any other.

## CTAs posted with 0.31.8 (two messages)

On the next refresh, party 1's message gets the whole roster, and party 2's message is edited once to "This party is now shown in the roster above." with no buttons; then its `content_message` row is deleted, so it is not edited again. Their one-line announcement keeps working.

## Data (migration 0033)

- `content.roster_channel_id text` (null).
- `content.bombers smallint` (null = no Bombers), `check (bombers between 1 and 20)`.
- `signup.status` gets `'bomber'` (the check is replaced). A bomber row has `slot_id` null and `party` 1.
- `slot_draft.bombers smallint` (the card's typed cap).
- `slot_preset.cta boolean not null default false`. Existing presets with a party 2 slot are set to `true`; the others stay normal. The unique name stays per server.
- Row level security stays on. The migration runs on production before the deploy.

## Tests

- Domain: Bombers cap parsing (empty, 1 to 20, refused otherwise); the pin notice finder (type 6 that refers to the message, ignores others); parties menu labels.
- DB: bomber join, move from a seat to Bombers and back, cap enforced under two joins at once, Leave, Tentative; `getManageTargetFor` refuses another guild and an unrelated channel; preset lists split by CTA.
- Render: the CTA message with one party, two parties, Bombers on and off; `discordProblems` and the 4000 budget with 40 full rows and 20 bombers; the 0.31.8 party 2 note; the normal snapshot unchanged.
- Handlers with fakes: create order (placeholder, thread, content, roster edit, forward, pin, notice delete), cleanup on failure; a click from the CTA channel finds the CTA; Manage from the channel; title edit renames the thread and does not overwrite the roster; old two-message CTA conversion.

## Not included

- Moving old CTAs' rosters out of their threads.
- Bombers on normal content, or a Bombers waitlist.
- Q25 (reposting a deleted roster) stays open.

## Records

ADR 0047, FR-070 updated, FR-071, FR-072 and FR-073 in `PRODUCT.md`, ADR 0044 superseded in part, ADR 0036, 0039 and FR-063 notes. Release 0.31.9.
