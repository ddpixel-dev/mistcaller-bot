---
title: CTA in one message, Bombers, CTA presets, quiet pins: implementation plan
type: plan
status: built in 0.31.9 (owner approved 2026-11-11: "proceed, record decisions, plans, implement and release")
date: 2026-11-11
satisfies: [FR-070, FR-071, FR-072, FR-073]
---

# Implementation plan (release 0.31.9)

Design: [2026-11-11-cta-one-message-bombers-design.md](2026-11-11-cta-one-message-bombers-design.md), ADR 0047. Branch `feature/cta-one-message` from `develop`. Tasks run in order; each one leaves `docker compose run --rm node npm test` and `docker compose run --rm node npx tsc --noEmit` green and is committed on its own.

Rules for every task:
- Tests first (node:test, the existing fakes in `tests/`). Domain code stays pure (NFR-007).
- Normal content must not change: `tests/render/fixtures/oneParty.snapshot.json` stays byte-identical, and no normal-content test is weakened.
- Every message keeps `allowed_mentions: { parse: [] }` (or the explicit users list where it already is). Never trust a client id: guild from the verified interaction, content checked against it.
- No new package. Comments say why, short.
- A migration that ran only on the local test database may be edited after resetting it: `docker compose exec -T db psql -U postgres -c "drop schema public cascade; create schema public;"`.

## Task 1: migration 0033 and the roster view

- `supabase/migrations/0033_cta_one_message.sql`: `content.roster_channel_id text`; `content.bombers smallint check (bombers between 1 and 20)`; replace `signup_status_check` with `('signed','waitlist','fill','applied','bomber')`; `slot_draft.bombers smallint` (same check); `slot_preset.cta boolean not null default false`, then `update slot_preset set cta = true where slots @> '[{"party": 2}]'`. Header comment like 0032.
- `src/domain/types.ts` `RosterView`: `rosterChannelId: string | null`, `bombers: number | null` (the cap), `bomberIds: string[]` (in sign-up order). `getRosterView` (`src/db/content.ts`) fills them; `createContent` takes `rosterChannelId?` and `bombers?`. Every place that builds a `RosterView` by hand in tests gets the new fields through the existing helpers.
- Check what else reads `signup.status` with a closed list (grep `status in (`, `status =`) and make sure a `bomber` row is ignored where it should be (seat counts, waitlist, fills, applicants) and included where the design says (Ping, attendance, the `partyOf` map must not mark it as a party member of a seat).
- Tests: DB test that a content with `bombers` and `roster_channel_id` round-trips; a bomber row appears in `bomberIds` and not in fills or waitlist.

## Task 2: pure helpers

`src/domain/bombers.ts`: `parseBombersCap(text): Result<number | null>` (empty → null, 1 to 20 → number, otherwise the error `Bombers must be a number from 1 to 20, or empty for no Bombers.`). `src/domain/pins.ts`: `findPinNotice(messages, pinnedId): string | null` (type 6 with `message_reference.message_id === pinnedId`). `src/domain/parties.ts`: `PARTIES_PLACEHOLDER = "How many parties?"` and the option labels `One Party` 👤 / `Two Parties` 👥. Unit tests for each.

## Task 3: quiet pins (FR-072)

- `src/discord/rest.ts`: `listMessages?(channelId, limit): Promise<{ id: string; type: number; message_reference?: { message_id?: string } }[]>` (GET `/channels/{id}/messages?limit=n`); `deleteMessage` exists.
- `src/handlers/pins.ts`: `pinQuietly(deps, channelId, messageId): Promise<boolean>` pins (throws like `pinMessage` so callers keep their notes and logs), then best effort: list the last 5 messages, `findPinNotice`, delete it. A failure after the pin is logged (`pin_notice_delete_failed`, name, status, code) and never thrown.
- Use it in `src/handlers/create.ts` (the normal roster pin) and `src/handlers/ctamsg.ts` (the CTA message pin). Tests with fakes: notice deleted; no notice; list fails; delete fails (403) — the pin still counts.

## Task 4: Bombers in the database (FR-071)

`src/db/signup.ts`:
- `joinBombers(sql, { contentId, guildId, userId, now })` → `"joined" | "already" | "full" | "off" | "unavailable"` plus `promoted`. In one transaction with the content row locked `for update` (like `claimSlot`): content open, `bombers` not null, count of bomber rows < cap; the user's existing row (seat, waitlist, fill, applied) becomes the bomber row (`status 'bomber'`, `slot_id null`, `fill_roles null`, `fill_slots null`, `party 1`, `chosen_weapon null`, tentative kept). A freed seat promotes that party's waitlist (`promoteWaitlist`).
- Joining a seat, the waitlist, a fill or applying while a bomber moves them out of Bombers (check `claimSlot`, `joinWaitlist`, the fill join and apply paths: they upsert on `(content_id, user_id)`; make sure the `bomber` status is overwritten and not refused).
- Leave and Tentative work on a bomber row. `getEntryParty` returns null for a bomber (no party).
- Removing a bomber (host): reuse the remove function if it deletes by user; otherwise add `removeBomber`.
- Tests: join, cap with two joins at once (two connections or sequential with the lock), full, off, move seat → Bombers frees the seat and promotes the waitlist, Bombers → seat, Leave, Tentative, not open.

## Task 5: one CTA message (render)

`src/render/roster.ts`:
- For `view.cta` (non-blank) render the whole CTA in one message: header; for each party a `**Party n (filled/of)**` heading (only when `partyCount > 1`) then its rows; then `**💣 Bombers (n/cap):** <@a> · <@b>` (❓ after tentative ones, cut at 600 characters) when `bombers` is set; then the applicants, fill and waitlist lines, each prefixed with `Party n ·` only when `partyCount > 1`. Menus: one join menu per party (placeholder `Party n: pick an open position (k)` with two parties, today's text with one), custom ids with `withParty`; one waitlist menu per party when a role there is full. Buttons: Leave, Tentative (shared, no suffix), `💣 Bombers n/cap` (`bomb:<id>`, dimmed when full or not open; only when bombers set), the vote, Ping, Manage, then the tips.
- Leave and Tentative are enabled when anyone holds a place, as now, counting bombers.
- Keep the text budget: compute `fits()` over the whole message (all rows of all parties + all lines). Drop weapon icons, then notes, then cut rows from the end.
- Non-CTA content goes through the existing path untouched (the snapshot test proves it). `renderRosterMessage(view, party)` keeps its signature; for a CTA the `party` argument is ignored.
- `renderMovedNote()`: the 0.31.8 party 2 message: a V2 container with "This party is now shown in the roster above." and no components.
- `rosterUrl` takes the roster's channel (`rosterChannelId ?? threadId`); update its callers (`grep -rn "rosterUrl\|rosterButton"`).
- Tests: one party no Bombers (no "Party 1" heading); two parties; Bombers on with tentative; 40 filled rows with weapons plus 20 bombers plus a waitlist stays under 4000 and `discordProblems` is empty (use the existing helper in `tests/render`); component count ≤ 40; snapshot unchanged.

## Task 6: finding the CTA from a click, and refreshing it

- `src/db/manage.ts`: `getManageTargetFor(sql, guildId, channelId, contentId?)`: with a content id (UUID-checked), load by id and return it only if `guild_id = guildId` and (`thread_id = channelId` or `roster_channel_id = channelId`); without one, today's lookup by thread. Return `rosterChannelId` in `ManageTarget`.
- Replace the ten `getManageTarget(...)` call sites in `src/handlers/{manage,manage-panel,attendance,me}.ts` with it, passing the content id each custom id already carries (Manage panel `mg:<id>`, `mg:<action>:<id>`, attendance `att:...`, me `me:...`, the edit modals). Slash commands pass none. Check each panel's follow-up custom ids carry the content id; add it where one does not.
- `src/handlers/rosters.ts` `refreshRosters`: edit at `view.rosterChannelId ?? view.threadId`. For a CTA: edit party 1's message with the whole CTA; for a `content_message` party 2 row (0.31.8 CTAs) edit it once with `renderMovedNote()` and delete the row (`deleteContentMessage`), ignoring 404. `except` keeps working for party 1.
- `src/handlers/signup.ts`: for a CTA the response is the whole message (`renderRosterMessage(view)`), and no other message is edited (except the 0.31.8 conversion via `refreshRosters`). Remove the `otherParty` refusals for Leave and Tentative on a CTA (shared buttons act on the player's place). Keep the `@2` handling for join and wait.
- Ping link, the `✅ Created` link, `/content list` links, calendar Open link: use the roster's channel.
- Title or start edit (`src/handlers/manage.ts` ~line 160): edit the old announcement only when `rosterChannelId` is null; the thread rename stays.
- Tests: a click from the CTA channel (channel = CTA channel, custom id with content id) opens Manage; another guild's content id is refused; a channel that is neither is refused; refresh edits the channel message; 0.31.8 CTA converts party 2 once; title edit does not touch the roster with the announcement body.

## Task 7: Bombers controls

- `src/handlers/bombers.ts` `handleBombers` for `bomb:<id>`: verified user and guild, content of that guild, `joinBombers`, answers: `already` → private "You are in Bombers. Press Leave to leave.", `full` → "Bombers is full.", `off`/`unavailable` → not valid / closed text as signup does; `joined` → `UPDATE_MESSAGE` with the whole roster, plus promotions announced like the seat paths do. Register in `src/discord/dispatch.ts` (not a party control).
- Remove player (`src/handlers/remove.ts`) and Attendance (`src/handlers/attendance.ts`): with `bombers` set, the party choice gets **💣 Bombers**, carried as the group number 3 (`withParty(prefix, 3)`, so `splitParty` accepts `3`; only Remove and Attendance accept 3, and only when `bombers` is set; every other control answers 3 as not valid). Bombers attendance counts as a third group for "submitted" (an empty list counts as submitted). Check `attendance_parties_submitted` handling: store 3 for Bombers.
- Ping includes bombers (check the query).
- Tests for each.

## Task 8: creating a CTA in the channel

`src/handlers/create.ts` `publish()` for `"channelId" in a.place`:
1. `createMessage(channelId, PLACEHOLDER)`; 2. `startThread(channelId, placeholder.id, postName(...))`; 3. `createContent({... rosterChannelId: channelId, bombers })`, `setMessageId(id, placeholder.id)`; 4. `editMessage(channelId, placeholder.id, renderRosterMessage(view))`; no roster pin and no party 2 message; 5. in parallel: dashboard refresh and `postCtaMessage`. No `announcementBody` edit. Cleanup on failure deletes the content, the thread and the placeholder.
Return `messageId` and the channel so the `✅ Created` link points at the message in the CTA channel. `announcementBody` stays for old CTAs only. Tests: order of calls, the roster edited at the channel, no pin of the roster, forward pinned quietly, cleanup at each failing step.

## Task 9: the CTA card, edit panel and presets

- `src/render/card.ts` / `src/handlers/card.ts` / `src/domain/card.ts` for `d.cta`: Parties menu with the Task 2 labels; **Details** modal: title, start, tier, notes, Bombers (`Bombers cap (1-20, empty = none)`); a **Slots** button (one party) or **Party 1 slots** (two parties) opens a modal with the party 1 box (CTA role check, as today); Party 2 slots and Copy party 1 stay. The card text shows `💣 Bombers: up to n` or nothing. Normal content keeps today's Details with the slots.
- `slot_draft.bombers` read and written; Create passes `bombers`.
- Edit panel (`src/handlers/manage-panel.ts`, `manage.ts`) for a CTA: Edit details = title, start, tier, notes, Bombers (lowering below the current number of bombers is refused with a clear message); Edit slots (party 1) and Edit party 2 slots separate.
- Presets: `listPresets(sql, guildId, cta)`, `savePreset(... cta)`; the cap of 25 counts per kind; the same name may not be used twice per server (keep the unique index); settings keep `bombers`. CTA card lists CTA presets only; Plan Content normal only.
- `/content help` mentions Bombers in one short line (stay under 2000 characters; the test checks).
- Tests for each.

## Task 10: records and release

- `changelog/0.31.9.md` in players' language with how-to steps (Bombers, signing up from the channel, the card buttons, CTA presets, the permission Manage Messages for removing pin notices).
- `PRODUCT.md`: FR-070 to FR-073 built in 0.31.9, Current state, Last updated, Next step; `docs/plan/next-session-handoff.md`; `docs/lessons.md` if something was learned.
- Release per the 0.32.0 brief checklist: version 0.31.9, migrate production, merge, tag, push, merge back, wait for the deploy, `scripts/register-commands.ts` only if commands changed, changelog dry run then post.
