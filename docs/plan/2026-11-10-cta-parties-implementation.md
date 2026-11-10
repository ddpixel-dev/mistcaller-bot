---
title: CTA two parties implementation plan
type: plan
status: proposed (awaiting owner review)
date: 2026-11-10
satisfies: [FR-070]
---

# CTA two parties Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CTA can have 1 or 2 parties of up to 20 players, each party with its own roster message, menus, fills and waitlist.

**Architecture:** `slot` and `signup` rows carry a `party`. `slot.position` stays unique per content (party 1 first, then party 2) so every existing lookup by position keeps working; the displayed number restarts in each party. Each party has a message row in `content_message`. One helper re-renders every party's message; the party travels in button IDs as an `@2` suffix that dispatch strips, so party 1's IDs and old rosters are unchanged. `maxPartiesFor` is the single hook ZvZ will reuse.

**Tech Stack:** TypeScript on Node 24 (type stripping), `postgres`, `node:test`, Discord Components V2. No new dependency (ADR 0006).

**Spec:** [2026-11-10-cta-pinned-message-and-parties-design.md](2026-11-10-cta-pinned-message-and-parties-design.md), Part 2; ADR 0044; FR-070. This plan refines the spec's data section (positions stay unique per content); the owner is asked to confirm it.

## Global Constraints

- Branch `feature/cta-parties` from `develop`, after `feature/cta-message` is merged (ADR 0014). Say which branch you are on.
- Docker only: `docker compose run --rm node npm test`, `docker compose run --rm node npx tsc --noEmit`, one file with `docker compose run --rm node node --test tests/<path>.test.ts`.
- Migration `0032_cta_parties.sql`; never edit a migration after it ran on production. Production is migrated **before** the code is deployed (the roster query reads the new columns).
- `party_count` is 1 or 2. At most 20 slots per party, so 40 per content. Supported CTA roles: **Tank, DTank, Healer, Support, DPS**. Normal content keeps accepting any role.
- New tables have a `guild_id`, row level security on, anon revoked (NFR-004). Keep no state in memory (NFR-005). Domain code has no Discord or database imports (NFR-007).
- Party 1's custom IDs do not change. Party 2's end in `@2`.
- A member holds one entry per content. Fill and waitlist are per party. The party count cannot change after creation.
- Every bot message keeps restricted allowed mentions (NFR-001). Unknown attendance is never a no-show (FR-014).
- Acknowledge every interaction within 3 seconds (NFR-002): edits to the other party's message go through REST after the response is built.

## Audit: where position and the roster message are used

The spec asked this plan to list every place. `slot.position` stays unique per content, so these lookups keep working and only gain a party where the table says so.

| Area (files) | Uses | Change |
|---|---|---|
| `src/db/signup.ts` (29 refs), `src/db/manage.ts` (12), `src/db/content.ts` (14), `src/db/attendance.ts` (5) | lookups by (content, position), `sortPositions`, `promoteWaitlist`, `joinFill`, `joinWaitlist`, `claimSlot` | Tasks 2 and 3: party on slot and signup rows; waitlist, fill and promotion run per party; `sortPositions` orders by (party, role) |
| `src/handlers/signup.ts`, `fill.ts`, `fill-pref.ts`, `waitlist.ts` | join, wait, Fill panel, leave | Task 6 (party from `i.party`) |
| `src/handlers/set-weapon.ts` (23), `duty.ts` (15), `me.ts` (10), `weapon-pick.ts`, `remove.ts` | host panels and the player's own panel, menus of positions | Task 9: party choice step; menus list one party's positions |
| `src/handlers/manage.ts`, `manage-panel.ts`, `attendance.ts`, `ping.ts`, `vote.ts`, `src/jobs/cron.ts` | nine call sites of `editMessage(view.threadId, view.messageId, renderRosterMessage(view))` | Task 4: one helper `refreshRosters` replaces all of them |
| `src/render/roster.ts` (7), `render/card.ts`, `render/attendance.ts`, `render/schedule.ts` | numbering, menus, party count | Tasks 5, 8, 11, 12 |
| `src/domain/fillmatch.ts`, `slots.ts`, `roles.ts`, `guided.ts`, `types.ts` | pure position logic | Task 1 (types gain `party`); `planSlotEdit` runs once per party (Task 10) |

## Review Focus

- A stale party-2 menu: a player picks a position that was taken a second ago, or by a move to the other party. They get the private "taken" reply, never a double seat, and both messages show the truth.
- A forged or odd party in a custom ID (`@0`, `@3`, `@-1`, `@x`, `@2` on a one-party content): refused privately, nothing changes.
- A moderator deletes the party 2 message: party 1 still updates, the failure is logged without text, nothing throws, and the next render does not loop.
- Content created before this release (no `content_message` row, no party columns set): every button, menu and panel on the old message keeps working.
- A fill waiting in party 1 while party 2 has open positions: they stay waiting (the per-party rule); the host sees them under party 1 only.

## File Structure

- Create `supabase/migrations/0032_cta_parties.sql`, `src/domain/parties.ts`, `src/handlers/rosters.ts` (`refreshRosters`), `src/handlers/party-pick.ts` (the Party 1 / Party 2 choice for host panels).
- Modify: `src/domain/types.ts`, `src/db/content.ts`, `src/db/signup.ts`, `src/db/manage.ts`, `src/db/attendance.ts`, `src/db/draft.ts`, `src/db/preset.ts`, `src/db/schedule.ts`, `src/discord/dispatch.ts`, `src/discord/types.ts`, `src/render/roster.ts`, `src/render/card.ts`, `src/render/attendance.ts`, `src/render/schedule.ts`, `src/handlers/*` listed in the audit, `tests/helpers/db.ts` (truncate `content_message`).
- Tests mirror each file under `tests/`.

---

### Task 1: Party domain (pure)

**Files:** Create `src/domain/parties.ts`, `tests/domain/parties.test.ts`. Modify `src/domain/types.ts`.

**Interfaces:**
- Produces: `MAX_PARTY_SLOTS = 20`, `CTA_ROLES = ["Tank","DTank","Healer","Support","DPS"] as const`
- Produces: `maxPartiesFor(kind: string, isCta: boolean): 1 | 2` (2 only when `isCta`)
- Produces: `parseCtaSlots(input: string, party: number, parties: number): Result<SlotDef[]>`: runs `parseSlots` (max 20 lines), then rejects any role not in `CTA_ROLES` (case-insensitive, matched by `roleRank`-style name), returning `Party 2, line 3: "Heal" is not a supported role. Use Tank, DTank, Healer, Support or DPS.` (when `parties` is 1 the prefix is `Line 3:`).
- Produces: `splitParty(customId: string): { id: string; party: number } | null` (null for a suffix that is not `@1` or `@2`; no suffix means party 1) and `withParty(customId: string, party: number): string` (no suffix for party 1)
- Produces: `displayNumber(slot: { party: number; position: number }, all: { party: number; position: number }[]): number` (position minus the number of slots in lower parties)
- Modifies: `RosterSlot` gains `party: number`; `RosterView` gains `partyCount: number`; `waitlist`, `fills` and `applied` entries gain `party: number`; `SlotDef` gains optional `party?: number`.

- [ ] **Step 1: Write the failing tests:** `maxPartiesFor("zvz", false) === 1`, `maxPartiesFor("other", true) === 2`; `parseCtaSlots("Tank - Axe\nHeal", 1, 2)` is an error whose text equals the message above with `Party 1, line 2`; accepts `tank`, `DPS - Bow (Caller)`; rejects 21 lines; `splitParty("join:abc@2")` is `{ id: "join:abc", party: 2 }`, `splitParty("join:abc")` is party 1, `splitParty("join:abc@3")`, `@0`, `@x` and `@-1` are `null`; `withParty("join:abc", 1)` is unchanged and `withParty("join:abc", 2)` ends `@2`; `displayNumber` restarts at 1 in party 2.
- [ ] **Step 2: Run** `docker compose run --rm node node --test tests/domain/parties.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the module and extend the types. Fix the compile errors the new required fields cause with `docker compose run --rm node npx tsc --noEmit` (give test fixtures and view builders `party: 1` defaults).
- [ ] **Step 4: Run** the new test and the whole suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: party domain, CTA role check (FR-070)`.

### Task 2: Schema, creation and the roster view

**Files:** Create `supabase/migrations/0032_cta_parties.sql`. Modify `src/db/content.ts`, `tests/helpers/db.ts`. Test `tests/db/parties.test.ts`, and update `tests/db/content.test.ts`, `tests/db/anon-tables.test.ts`.

**Interfaces:**
- Consumes: Task 1 types.
- Produces: migration columns `content.party_count smallint not null default 1 check (party_count in (1,2))`, `slot.party smallint not null default 1`, `signup.party smallint not null default 1`, `slot_draft.parties smallint not null default 1`, `slot_draft.slots2 jsonb not null default '[]'`, `slot_draft.slots2_text text`; table `content_message (guild_id text not null, content_id uuid not null references content on delete cascade, party smallint not null, message_id text not null, primary key (content_id, party))` with RLS and the anon revoke block. Existing rows keep party 1.
- Produces: `NewContent` gains `slots2?: SlotDef[]` (party 2's positions; `party_count` is 2 when present and non-empty).
- Produces: `getPartyMessages(sql: Sql, contentId: string): Promise<{ party: number; messageId: string }[]>` (party 1 comes from `content.message_id`, others from `content_message`, ordered by party) and `setPartyMessageId(sql: Sql, a: { guildId: string; contentId: string; party: number; messageId: string }): Promise<void>` (party 1 writes `content.message_id`).
- Produces: `sortPositions` orders by (party, role rank, old position) and numbers 1..n across the content; `getRosterView` returns `partyCount`, `party` on slots and on the three lists.

- [ ] **Step 1: Write the failing tests** in `tests/db/parties.test.ts`: a content created with `slots` (2) and `slots2` (3) has `partyCount` 2, party 1 positions 1 and 2, party 2 positions 3, 4, 5, each party ordered Tank, DTank, Healer, Support, DPS; with no `slots2` it is party 1 only; `displayNumber` of the first party 2 slot is 1; `sortPositions` after an edit keeps party 1 before party 2; `setPartyMessageId` then `getPartyMessages` returns both parties in order and party 1 equals `content.message_id`; deleting the content deletes its `content_message` rows; `slot` party 2 count above 20 is refused by the caller (create rejects a party over `MAX_PARTY_SLOTS`).
- [ ] **Step 2: Run** `docker compose run --rm node node --test tests/db/parties.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write the migration and the DB code.** In `insertContent` insert party 1 slots with `party = 1` and party 2 slots with `party = 2`, sorting each party by role, positions continuing across. Change `sortPositions` as described, keeping its negative-number swap to avoid the unique key.
- [ ] **Step 4: Run** `docker compose run --rm node npm test`. Expected: PASS, including `tests/db/migrate.test.ts` and the anon test.
- [ ] **Step 5: Commit** `feat: parties schema, migration 0032`.

### Task 3: Sign-ups per party

**Files:** Modify `src/db/signup.ts`, `src/db/manage.ts` (`editContent` is Task 10). Test `tests/db/parties-signup.test.ts` plus existing `signup`, `fill`, `waitlist`, `selection`, `tentative` tests must stay green.

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: `claimSlot` writes `signup.party` from the slot, so a seated player who claims a slot in the other party is **moved** (one entry per content). `joinWaitlist`, `joinFill` and the application path take `party: number` in their args (default 1) and store it. `promoteWaitlist(tx, contentId, now)` promotes a waitlisted or fill player only into a free slot of **their own party**. `assignPlayer` sets `party` from the target slot. `leaveContent` is unchanged. `leaveContent` and `setTentative` keep acting on the player's entry; handlers compare parties (Task 6), so add `getEntryParty(sql, contentId, userId): Promise<number | null>`.

- [ ] **Step 1: Write the failing tests:** a seated player claiming a party 2 slot is moved, the party 1 seat is free, `signup.party` is 2; two players claiming the same slot: the second gets `taken` (the unique index); a waitlist entry in party 1 is not promoted when only a party 2 slot frees; it is promoted when a party 1 slot of its role frees; a fill (Any) in party 2 is seated in the first suitable party 2 position, healers first, and waits when party 2 is full even if party 1 has room; host `assignPlayer` into party 2 sets party 2; applications record the party; `getEntryParty` returns `null` for a stranger.
- [ ] **Step 2: Run** `docker compose run --rm node node --test tests/db/parties-signup.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** by adding `party` filters to the waitlist and fill queries and to the free-slot search inside `promoteWaitlist` and `joinFill`; party-1-only content behaves as before.
- [ ] **Step 4: Run** `docker compose run --rm node npm test`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat: fill, waitlist and applications per party`.

### Task 4: One helper re-renders every party message

**Files:** Create `src/handlers/rosters.ts`, `tests/handlers/rosters.test.ts`. Modify the nine call sites in `src/handlers/weapon-pick.ts`, `ping.ts`, `signup.ts`, `manage.ts`, `attendance.ts` (two) and `src/jobs/cron.ts` (and `vote.ts`/`me.ts`/`set-weapon.ts` where they edit the roster by REST).

**Interfaces:**
- Consumes: `getPartyMessages` (Task 2), `getRosterView`, `renderRosterMessage(view)` (Task 4 calls it with one argument; Task 5 adds the `party` parameter and updates this helper to pass each party).
- Produces: `refreshRosters(deps: Deps, view: RosterView, opts?: { except?: number }): Promise<void>`: edits the message of every party except `opts.except`, one `editMessage` per party; a failure on one party is logged (`evt: "roster_edit_failed"`, no message text) and does not stop the others.

- [ ] **Step 1: Write the failing tests** with a recording fake `Rest`: two parties produce two edits to the right message IDs; `except: 1` skips party 1; one failing edit still performs the other and does not throw; a content with no messages rows and a null `messageId` makes no call; a one-party content makes exactly one edit, to `view.messageId`.
- [ ] **Step 2: Run** `docker compose run --rm node node --test tests/handlers/rosters.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the helper**, then replace each `if (view?.messageId) await deps.rest.editMessage(...)` call with `refreshRosters`, keeping the existing `try/catch` behaviour of each site.
- [ ] **Step 4: Run** `docker compose run --rm node npm test`. Expected: PASS (behaviour unchanged for one party).
- [ ] **Step 5: Commit** `refactor: refreshRosters replaces nine roster edits`.

### Task 5: Rendering a party's message

**Files:** Modify `src/render/roster.ts`, `tests/render/roster.test.ts` (and `tests/helpers/discordLimits.test.ts` use).

**Interfaces:**
- Consumes: `withParty`, `displayNumber` (Task 1).
- Produces: `renderRosterMessage(view: RosterView, party = 1)`. Party 1 is today's message with only party 1's rows, lists, count and menu; when `view.partyCount` is 2 its title gets a `Party 1` line. Party 2 is a smaller message: accent colour of the content, a `## Party 2` heading, its rows (numbers from `displayNumber`), its tentative and fill and waitlist and applicants lines, its own open-positions menu, Join/Leave/Tentative/Fill, and **no** Manage, Ping, loot vote or tips. Every custom ID of party 2 passes through `withParty(id, 2)`; party 1's are unchanged. The roster header party count for a two-party content reads `n/total` for the party plus the total on party 1.

- [ ] **Step 1: Write the failing tests:** party 1 of a two-party view lists only party 1 slots numbered from 1; party 2 lists only its slots numbered from 1 (positions 3 to 5 show 1 to 3); party 2's menu offers only open party 2 positions and every custom ID ends `@2`; party 1's IDs have no suffix and are identical to the current output for a one-party view (snapshot a saved current render); a 20-row party with fills, waitlist and applicants stays under 4000 characters and passes `discordProblems`; party 2 has no Manage, Ping or vote buttons; a cancelled or done content greys both messages.
- [ ] **Step 2: Run** `docker compose run --rm node node --test tests/render/roster.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** by slicing the view per party at the top of the renderer and reusing the existing building blocks; do not duplicate the row formatter.
- [ ] **Step 4: Run** `docker compose run --rm node npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: render each party as its own roster message`.

### Task 6: Dispatch and the player buttons

**Files:** Modify `src/discord/dispatch.ts`, `src/discord/types.ts` (`Interaction` gains `party?: number`), `src/handlers/signup.ts`, `fill.ts`, `fill-pref.ts`, `waitlist.ts`, `me.ts`. Tests `tests/handlers/parties-signup.test.ts`, `tests/discord/dispatch.test.ts` (create if absent).

**Interfaces:**
- Consumes: `splitParty`, `getEntryParty`, `refreshRosters`.
- Produces: dispatch strips the `@N` suffix from `data.custom_id` before routing and sets `i.party`; a suffix that `splitParty` rejects is answered privately ("This control is not valid") with no handler call. A party suffix on content whose `partyCount` is 1 is refused by the handlers with the same reply. Handlers read `i.party ?? 1`.
- Behaviour: join, wait, Fill, Leave and Tentative act for that party. A player in the **other** party pressing Leave or Tentative gets a private `You are in Party N. Use its Leave button.` A response returns the render of the pressed party; the other party's message is refreshed with `refreshRosters(deps, view, { except: party })`.

- [ ] **Step 1: Write the failing tests:** dispatch routes `join:abc@2` to the join handler with `party` 2 and `custom_id` `join:abc`; `@3`, `@0`, `@x` get the private refusal; a seated party 1 player picking a party 2 position is moved and both messages are refreshed; picking a taken position gives the private "taken" reply; Leave on party 2 by a party 1 player gives the pointer reply and changes nothing; Tentative likewise; Fill on party 2 with no suitable open party 2 position waits in party 2; waitlist join on party 2 records party 2; an old one-party roster button without suffix works as before.
- [ ] **Step 2: Run** the two files. Expected: FAIL.
- [ ] **Step 3: Implement** the dispatch strip and the handler changes.
- [ ] **Step 4: Run** `docker compose run --rm node npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: player buttons act per party`.

### Task 7: Posting the party messages

**Files:** Modify `src/handlers/create.ts` (`publish`, `PublishInput` gains `slots2?: SlotDef[]`), tests `tests/handlers/create.test.ts`.

**Interfaces:**
- Consumes: Tasks 2, 4, 5 and, when merged, `postCtaMessage` from the pinned-message plan.
- Produces: after the roster (party 1) is posted and pinned as today, party 2 is posted with `createMessage(threadId, renderRosterMessage(view, 2))`, saved with `setPartyMessageId`, then pinned. `postCtaMessage` runs after party 2 so the order in the thread is party 1, party 2, copy. A failure to post party 2 deletes the content and its post exactly as a failed roster does today (`dropPost`) and tells the creator.

- [ ] **Step 1: Write the failing tests** (recording fake `Rest`): a CTA with two parties makes `createMessage` and `pinMessage` calls in the order party 1, party 2, (copy); `content_message` has both rows; a failing party 2 post removes the content and the post; a one-party CTA and normal content make no party 2 call.
- [ ] **Step 2: Run** `docker compose run --rm node node --test tests/handlers/create.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `docker compose run --rm node npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: post and pin one message per party`.

### Task 8: The creation card

**Files:** Modify `src/domain/card.ts` (`CardInput` gains `cta`, `parties`, `slots2`, `slots2Text`; `validateCard` runs `parseCtaSlots` per party for a CTA), `src/render/card.ts`, `src/handlers/card.ts`, `src/db/draft.ts`, `src/db/preset.ts`. Tests `tests/domain/card.test.ts`, `tests/handlers/card.test.ts`, `tests/db/draft.test.ts`, `tests/db/preset.test.ts`.

**Interfaces:**
- Consumes: `maxPartiesFor`, `parseCtaSlots`, Task 2 draft columns.
- Produces: a **Parties** select (`cc:parties:<id>`, options 1 and 2, default 1) shown only when `maxPartiesFor(d.kind, d.cta) > 1`; with 2 parties the Details box label is `Party 1 slots (one per line: Role - Weapon)` and the card shows a **Party 2 slots** button (`cc:p2:<id>`, opens modal `ccs2:<id>` with one 1500-character box, label `Party 2 slots`) and a **Copy party 1** button (`cc:copy:<id>`, copies the lines). Both boxes use the placeholder `Tank - Axe` and a hint line `Roles: Tank, DTank, Healer, Support, DPS`. The card text lists both parties' counts. For a CTA, an unsupported role is a problem on the card with the exact message of Task 1; typed lines that fail are kept (`slotsText`, `slots2Text`) for Fix and retry. Presets: slots saved with `party` in their JSON (absent means 1), so older presets load as one party; loading a preset sets `parties` to the highest party. Dropping to 1 party clears `slots2`.

- [ ] **Step 1: Write the failing tests:** the Parties menu is absent for normal content and present for a CTA; choosing 2 stores `parties` 2; the Party 2 button opens the modal prefilled; submitting valid lines stores them; Copy party 1 duplicates; Create with a party 2 line `Heal` lists `Party 2, line 1: "Heal" is not a supported role. Use Tank, DTank, Healer, Support or DPS.` and posts nothing; Create with two valid parties calls `publish` with `slots` and `slots2`; blank CTA ignores parties; a preset saved from a two-party card loads both parties; an old preset (no `party` keys) loads as one party; `validateCard` for normal content still accepts any role.
- [ ] **Step 2: Run** the four files. Expected: FAIL.
- [ ] **Step 3: Implement** the domain validation first, then the draft and preset storage, then the card render and handlers.
- [ ] **Step 4: Run** `docker compose run --rm node npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Parties choice and party 2 slots on the creation card`.

### Task 9: Host panels ask for the party

**Files:** Create `src/handlers/party-pick.ts`. Modify `src/handlers/manage-panel.ts`, `fill.ts` (Assign, Add), `remove.ts`, `set-weapon.ts`, `duty.ts`, `weapon-pick.ts`, `me.ts` where a menu lists positions or applicants. Tests: the matching files under `tests/handlers/`.

**Interfaces:**
- Produces: `partyChoice(customIdPrefix: string, contentId: string, view: RosterView): unknown | null` returns a row of two buttons `Party 1` and `Party 2` whose IDs are `withParty(prefix:contentId, n)`; it returns `null` when `view.partyCount` is 1, in which case the panel opens directly as today.
- Behaviour: Assign, Add, Remove, Set weapon, Duty and Review applicants show the choice first when the content has two parties, then run the existing panel for that party; their menus list only that party's positions, applicants or fills (always at most 25 options). The panel's later component IDs carry `@party` through `withParty`.

- [ ] **Step 1: Write the failing tests** per panel: two-party content shows the Party 1 / Party 2 buttons first; choosing Party 2 opens a menu with only party 2 positions; one-party content skips the choice; Assign into party 2 seats the player in party 2; Remove removes from the chosen party only; Review applicants lists that party's applicants.
- [ ] **Step 2: Run** the panel test files. Expected: FAIL.
- [ ] **Step 3: Implement** the helper and wire each panel; reuse each handler's existing code path with the party filter.
- [ ] **Step 4: Run** `docker compose run --rm node npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: host panels choose a party first`.

### Task 10: Edit slots with parties

**Files:** Modify `src/db/manage.ts` (`EditInput` gains `slots2?: SlotDef[]`; `editContent` runs `planSlotEdit` once per party), `src/handlers/manage.ts`, `src/handlers/manage-panel.ts`, `src/render/card.ts` if the Edit panel reuses it. Tests `tests/db/manage.test.ts`, `tests/handlers/manage.test.ts`.

**Interfaces:**
- Consumes: `planSlotEdit` (unchanged), `parseCtaSlots`.
- Produces: the Edit panel for a two-party content opens Edit details with `Party 1 slots`, and an **Edit party 2 slots** button opening the party 2 box; saving validates both parties (CTA role check) and applies one plan per party in the same transaction; new slots get the party; a slot someone holds cannot be removed (the existing error, naming the party); `party_count` is never changed; an edit that changes only party 2 leaves party 1's players untouched.

- [ ] **Step 1: Write the failing tests:** adding a line to party 1 does not move party 2's holders (positions renumber, holders keep their slots); renaming a party 2 line keeps its holder; removing a held party 2 slot is refused with a message naming `Party 2`; an unsupported role in an edit of a CTA is rejected, in normal content accepted; the party count stays.
- [ ] **Step 2: Run** the files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `docker compose run --rm node npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: edit slots per party`.

### Task 11: Attendance per party

**Files:** Modify `src/db/attendance.ts`, `src/render/attendance.ts`, `src/handlers/attendance.ts`. Tests `tests/handlers/attendance.test.ts`, `tests/db/stats.test.ts`.

**Interfaces:**
- Produces: `Player` gains `party: number`. For a two-party content the attendance form starts with the party choice (`partyChoice`), then lists that party's players (at most 25); submitting marks only what was shown; unmarked stays unrecorded (FR-014). Statistics and `memberHistory` count a player once across both parties.

- [ ] **Step 1: Write the failing tests:** the choice appears only for two parties; marking party 2 does not change party 1's marks; a player in party 2 who is never marked counts as not recorded, never a no-show; history counts one attendance for a player who moved between parties.
- [ ] **Step 2: Run** the files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `docker compose run --rm node npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: attendance per party`.

### Task 12: Shared controls, calendar, lists

**Files:** Modify `src/handlers/ping.ts`, `src/db/ping.ts`, `src/handlers/manage.ts` (lock, unlock, cancel, end, reopen), `src/jobs/cron.ts`, `src/db/schedule.ts`, `src/render/schedule.ts`, `src/handlers/content.ts`/list command. Tests: matching files.

**Interfaces:**
- Behaviour: Ping reaches every seated player and fill across both parties once (existing per-player claim). Lock, cancel, end and reopen refresh every party message through `refreshRosters`. The vote lives on party 1's message only. The calendar and the list show the content's total as `n/total` (for example `31/40`); the Open link goes to party 1's message.

- [ ] **Step 1: Write the failing tests:** Ping on a two-party content pings a party 2 player once and a player in both lists once; Cancel greys both messages (two edits); the calendar line shows `31/40`; the cron reminder still works for a content with two parties and refreshes both messages; party 2's message has no vote buttons.
- [ ] **Step 2: Run** the files. Expected: FAIL.
- [ ] **Step 3: Implement** by counting slots across parties in `listSchedule` and `listUpcoming`.
- [ ] **Step 4: Run** `docker compose run --rm node npm test` and `docker compose run --rm node npx tsc --noEmit`. Expected: PASS, no errors.
- [ ] **Step 5: Commit** `feat: shared controls and totals for two parties`.

### Task 13: Help, records, release

**Files:** Modify `src/handlers/help.ts` (+ test), `PRODUCT.md`, `docs/INDEX.md`, `docs/plan/next-session-handoff.md`, `docs/plan/2026-11-06-zvz-brief.md`, `docs/lessons.md` if something was learned. Create `changelog/x.y.z.md` at release.

- [ ] **Step 1: Write the failing test:** help mentions two parties for CTA and the supported roles.
- [ ] **Step 2: Run** the help test. Expected: FAIL.
- [ ] **Step 3: Update the help text, then the records:** FR-070 `built` with the release number, the spec's refinement note confirmed, ZvZ brief points at the built model, Current state in `PRODUCT.md`. Run the audit in `docs/process/guardrails.md`. Expected: no new lines.
- [ ] **Step 4: Verify end to end by hand** on a test guild: create a two-party CTA with a wrong role (error), then a valid one (three pinned messages if `cta-msg` is set), join, move between parties, fill, leave, host Assign and Remove for each party, attendance, cancel.
- [ ] **Step 5: Release** by the checklist of `2026-11-06-zvz-brief.md`: `release/x.y.z`, bump `package.json` and `package-lock.json`, **run `scripts/migrate.ts` on production before the deploy**, merge to `main`, tag, push, wait for READY, `scripts/register-commands.ts` only if commands changed, write `changelog/x.y.z.md` (how to create a two-party CTA, the supported roles, how players choose a party), `scripts/post-changelog.ts x.y.z --dry-run`, then without the flag. Commit `docs: FR-070 built`.

### Task 14: CTA announcement and thread in the post-name format (owner decision 2026-11-10, option B)

**Files:** Modify `src/handlers/create.ts` (the CTA branch of `publish`), `src/handlers/manage.ts` (the title/start edit that renames the post), tests `tests/handlers/create.test.ts`, `tests/handlers/manage.test.ts`.

**Interfaces:**
- Consumes: `postName(title, startsAt)` (src/domain/postname.ts, ADR 0043), `rosterButton({ guildId, threadId, messageId })` (src/render/roster.ts, FR-063), `getCtaChannel` (src/db/cta.ts).
- Produces: a CTA thread is named `postName(title, startsAt)` when it is started (today it is the bare title). The announcement reads `📣 **<postName>** · <t:epoch:f>` and, once the roster is posted, is edited to carry the Roster button (`rosterButton`) pointing at party 1's roster. A thread started from a message has the message's id, so the announcement is `(ctaChannel, content.threadId)`.
- On a title or start edit of a CTA, after the thread is renamed, the announcement is edited to the new text (keeping the button). A failed announcement edit is logged (no text) and never fails the edit.

- [ ] **Step 1: Write the failing tests:** a created CTA starts its thread with the name `Raid | 12 Nov | 20:00 UTC`; the announcement content starts `📣 **Raid | 12 Nov | 20:00 UTC**`; after the roster is posted the announcement is edited with a Roster button whose link is the party 1 roster; a title edit of a CTA edits the announcement at (cta channel, thread id) with the new name; a failing announcement edit still returns the edit's success; normal content makes no announcement calls.
- [ ] **Step 2: Run** the two files. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep the button edit after the roster post and before the CTA message forward; it must not push the reply past 3 seconds (run it in the same `Promise.all` as the dashboard refresh and the forward).
- [ ] **Step 4: Run** `docker compose run --rm node npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: CTA announcement and thread use the post name`.
