# Applicant fix and the 2026-11-22 batch: implementation plan (releases A and B, shipped together)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship FR-078, FR-079 and FR-080 as release 0.31.11. The owner merged releases A and B into one release on 2026-11-22.

**Architecture:** These are small, local changes to the existing handlers and renderers. There is one migration (0035, `slot_draft.editing_preset_id`) and no new module.

**Tech Stack:** TypeScript on Node 24, run with `node --test` in Docker. Postgres 16 in the test database.

**Spec:** [2026-11-22-slot-modes-and-batch-design.md](2026-11-22-slot-modes-and-batch-design.md), sections "Release A" and "Release B".

**Branch:** `feature/applicant-fix-and-batch`, from develop.

## Global Constraints

- Run every command in Docker: `docker compose run --rm node npm test`.
- Write each test first and watch it fail before changing code.
- Domain logic stays pure (NFR-007). Every message uses `allowed_mentions: { parse: [] }`.
- Custom ids do not change (`mg:`, `fa:`, `rm:`), so messages already posted keep working.
- Old content keeps the labels of categories that are no longer offered (`LEGACY_KINDS`).

## Review Focus

1. A fill (not an applicant) in Add player whose chosen positions are all filled. They must still be placeable (Task 1 test).
2. A two-party CTA in Review applicants. The menu lists only the open positions of the chosen party (Task 1 test).
3. A Discord message over the component limit after adding the calendar dividers. `discordProblems` must stay empty with 12 events (Task 5 test).
4. Old ZvZ content with the category `outposts`, `castle` or `skirmish`. It must keep its label (Task 2 test).
5. Edit preset where the preset was deleted meanwhile, or renamed onto another preset's name. A clear message, and no new preset created (Task 6 test).

---

### Task 1: The host can place an applicant or fill in any open position (FR-079)

**Files:**
- Modify: `src/handlers/fill.ts` (`panel`)
- Test: `tests/handlers/selection.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - `"FR-079: an applicant whose position was filled can be placed in another open position"`. A and B apply for #2, and A is accepted. Review then shows B with the description `Applied: #2 (taken)`. Picking B shows a position menu with #1 and #3, and choosing #3 seats B.
  - `"FR-079: the positions the player asked for come first, marked Asked for"`. B applies for #3. The options read #3 (description `Asked for`), then #1 and #2.
  - `"FR-079: Add player places a fill whose positions are all filled"`, the same as the first test but for a fill in a normal event.
- [ ] **Step 2: Run the tests and see them fail.** `docker compose run --rm node node --test tests/handlers/selection.test.ts`
- [ ] **Step 3: Implement.**
  - `open` = every open position of the party: the matching ones first, then the rest, each group in position order.
  - The matching ones get the description `Asked for`.
  - The panel text: when there are matches, "...positions they asked for come first". When the player has a preference but nothing matches, "The position they asked for is taken; pick another."
  - The applicant description gets ` (taken)` when the preference is `slotIds` only and every one of those positions is filled.
- [ ] **Step 4: Run all tests and see them pass.** `docker compose run --rm node npm test`
- [ ] **Step 5: Commit** with message `fix: the host can place an applicant or fill whose position is taken (FR-079)`.

### Task 2: Categories (FR-080)

**Files:**
- Modify: `src/domain/kinds.ts`
- Test: `tests/domain/kinds.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - The PvE list includes `tracking` (label "Tracking", icon 🐾). PvX does not include it.
  - The PvP list has no `skirmish`, and `kindDef("pvp","skirmish").label === "Skirmish"`.
  - ZvZ lists exactly Faction Warfare, Outpost & Castle (`outpost-castle`, 🏯), Siege, Territory Attack (`territory-attack`, 🗡️), Territory Defense, then Other.
  - `kindDef("zvz","outposts")` and `kindDef("zvz","castle")` still give their labels.
  - PvP still lists Outpost and Castle.
- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement.**
  - Edit `KINDS`.
  - Add `tracking` to `PVX_LEFT_OUT`.
  - Move Skirmish (pvp) and ZvZ Outpost and Castle to `LEGACY_KINDS`.
  - Check that `kindDef` finds a legacy entry by type `zvz`. Today it matches `k.type === type`, so that works.
  - Fix any existing test that listed Skirmish or the old ZvZ list.
- [ ] **Step 4: Run all tests and see them pass.**
- [ ] **Step 5: Commit** with message `feat: Tracking in PvE, no Skirmish, ZvZ Territory Attack and Outpost & Castle (FR-080)`.

### Task 3: Roster party icons and the selection note (FR-080)

**Files:**
- Modify: `src/render/roster.ts` (`PARTY_ICONS`, `renderHeader`, `SELECTION_NOTE`)
- Test: `tests/render/roster.test.ts`, and existing tests that assert ⚔️ or 🛡️ party titles or the note's position

- [ ] **Step 1: Write the failing tests.**
  - Party headings start with `👥 **Party 1` and `👥 **Party 2`.
  - In a selection event, the line right after the `🌍 **Your time**` line is `-# 🎯 Host picks the party: apply, and the host accepts you.`, and no other line reads `Host picks the party`.
- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement.** Set `PARTY_ICONS = ["👥", "👥"]`, set `SELECTION_NOTE` to the new text, and place it after the Your time fact.
- [ ] **Step 4: Run all tests and see them pass.** Update any old assertions.
- [ ] **Step 5: Commit** with message `feat: party headings use 👥 and the host-picks note sits under Your time (FR-080)`.

### Task 4: Button names: Add player, ❌ Remove player, Edit content (FR-080)

**Files:**
- Modify:
  - `src/handlers/manage-panel.ts`: the buttons and the heading "🛠️ **Edit this content.** Only you can see this."
  - `src/render/roster.ts`: the three Manage buttons, label `Edit content`
  - `src/handlers/help.ts`, `fill.ts`, `remove.ts`, `duty.ts`, `set-weapon.ts`, `content.ts` and `src/db/manage.ts`: every "**Manage**", "Manage →" and "Assign player" text
- Test: `tests/handlers/selection.test.ts`, `manage-panel.test.ts` and others that match labels

- [ ] **Step 1: Write the failing test.** The roster's buttons include `Edit content` and not `Manage`. The panel has `Add player` (✍️), `Remove player` (❌) and no `Assign player`.
- [ ] **Step 2: Run the test and see it fail.**
- [ ] **Step 3: Implement.** Rename the labels and texts. Check with `grep -rn "Assign player\|\*\*Manage\*\*\|Manage →\|\"Manage\"" src`, which must print nothing.
- [ ] **Step 4: Run all tests and update old label assertions.** The suite passes.
- [ ] **Step 5: Commit** with message `feat: Add player, ❌ Remove player, and the roster's Edit content button (FR-080)`.

### Task 5: Calendar dividers (FR-080)

**Files:**
- Modify: `src/render/schedule.ts` (`renderSchedule`, `message`)
- Test: `tests/render/schedule.test.ts`

**Interfaces:**
- `message(parts: (string | typeof DIVIDER)[])`, where `DIVIDER = { type: 14, divider: true, spacing: 1 }`.

- [ ] **Step 1: Write the failing tests.**
  - In a day with a CTA and a normal event, the container's components are text, divider, text, in that order, and the CTA text comes first.
  - With one running event and one tomorrow, a divider sits between the `🔴 Live now` text and the day text.
  - With 12 mixed events, `discordProblems` gives `[]`.
- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement.**
  - A page becomes a list of parts.
  - A day group with both kinds pushes its CTA text, then `DIVIDER`, then its content text. The heading stays on the first text, and the labels are kept.
  - After the Live now group, push `DIVIDER`, unless it is the last part of the page.
- [ ] **Step 4: Run all tests and see them pass.**
- [ ] **Step 5: Commit** with message `feat: calendar dividers between CTA and content, and after Live now (FR-080)`.

### Task 6: Edit preset (FR-078)

**Files:**
- Create: `supabase/migrations/0035_edit_preset.sql`: `alter table slot_draft add column editing_preset_id uuid references slot_preset (id) on delete set null;`
- Modify:
  - `src/db/draft.ts`: read and save `editingPresetId: string | null`
  - `src/db/preset.ts`: `updatePreset(sql, a: { guildId; id; name; slots; settings; createdBy; cta }): Promise<"ok" | "gone" | "name_taken">`
  - `src/render/card.ts`: `renderPresetPanel` and the card note
  - `src/handlers/card.ts`
- Test: `tests/db/preset.test.ts`, `tests/handlers/card.test.ts`

The new flow:

- The main panel gets the button **Edit preset** (✏️, `cc:editpreset:<draft>`). It is dimmed when there are no presets.
- It opens a pick view with `cc:editpick:<draft>`.
- Picking a preset loads it as `case "preset"` does, sets `editingPresetId`, and shows the card with the note `✏️ Editing the preset **Name**. Change the card, then Manage presets → Save preset.`
- While editing, the main panel shows **Save preset** (`cc:savepreset`). Its modal `ccp:<draft>` comes prefilled with the name and titled "Save preset". On submit it calls `updatePreset`.
- `case "preset"` (loading from the menu) clears `editingPresetId`.

- [ ] **Step 1: Write the failing tests.**
  - db: `updatePreset` changes the name, slots and settings of that id. It returns `name_taken` when another preset (either kind) has the new name, and `gone` when the id no longer exists.
  - handler: Edit preset, then pick P, then the card note says it is editing P. The panel shows `Save preset`. Submitting the name `P2` renames and updates P, and `listPresets` count is unchanged.
  - handler: loading a preset from the Preset menu ends edit mode, and the panel shows `Save as preset` again.
  - handler: the preset is deleted during the edit, then submitting gives "That preset no longer exists." and creates nothing.
- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement** as described above. Non-admins are refused at every step, as today.
- [ ] **Step 4: Run all tests, plus `npm run typecheck`, and see them pass.**
- [ ] **Step 5: Commit** with message `feat: edit an existing preset from Manage presets (FR-078)`.

### Task 7: Docs and release 0.31.11

- [ ] **Step 1: Update the records.**
  - `help.ts` mentions Edit preset.
  - `changelog/0.31.11.md` is written in the players' language.
  - `PRODUCT.md`: FR-078, FR-079 and FR-080 become "built, release 0.31.11", and the current state is updated.
  - The `docs/INDEX.md` entry for this plan.
  - The design doc's status becomes "accepted; A and B built in 0.31.11".
- [ ] **Step 2: Run the full suite and typecheck in Docker.**
- [ ] **Step 3: Run the release flow** from `docs/plan/next-session-handoff.md`: bump, migrate production (0035), merge to main, tag `v0.31.11`, push, wait for Vercel READY, register commands only if they changed (they did not), and announce the changelog after a dry run.
