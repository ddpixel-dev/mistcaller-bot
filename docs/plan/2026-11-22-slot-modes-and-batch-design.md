---
title: Slot modes (Role or Weapon), strict slot terms, Edit preset, and the 2026-11-22 batch
type: design
status: accepted 2026-11-22; releases A and B built together in 0.31.11, release C next
date: 2026-11-22
tags: [slots, presets, calendar, kinds, selection, roster]
satisfies: [FR-076, FR-077, FR-078, FR-079, FR-080]
decisions: [0049]
---

# Slot modes, strict slot terms, Edit preset, and the 2026-11-22 batch

## Intent

On 2026-11-22 the owner asked for eleven changes. They split into three releases:

1. **A bug fix** (release A, hotfix). The host cannot place an applicant whose chosen position is filled.
2. **Small changes** (release B). Categories, icons, labels, calendar dividers, and Edit preset.
3. **Slot modes and strict slot terms** (release C). A content's slots are written by role, as today, or by weapon. Roles and weapons must come from fixed lists.

The owner's reasons:

- **Weapon mode.** "Albion players already know what a weapon is for." The bot must not imply that an axe means a tank style. The owner chose a per-content switch (option C) "for a better and cleaner data model and implementation design".
- **Strict terms.** Unusual roles and weapons must not be accepted on any content.
- **Bug.** The host must always be able to place an applicant in an open position.

## Guardrail check

| ID | Verdict | Note |
|---|---|---|
| FR-003 | supersedes in part | A slot line was free text `Role - Weapon`. The role is now one of five, the weapon is from the game list, and weapon mode adds `Weapon (Duty)`. Approved by the owner on 2026-11-22. |
| FR-030 | consistent | A role alone (no weapon) stays valid in role mode. In weapon mode every slot has a weapon, so the weapon picker never shows. |
| FR-070 | supersedes in part | The CTA-only role check becomes the check for every content. |
| FR-057, FR-058 | supersedes in part | Applicant matching: the host may place an applicant in any open position (bug fix). In weapon mode, a fill chooses weapons in place of roles. |
| FR-023, ADR 0010, ADR 0048 | supersedes in part | Category list: Tracking (PvE), Skirmish removed, Territory Attack and Outpost & Castle (ZvZ). |
| ADR 0041 | supersedes in part | "Assign player" is renamed "Add player". |
| ADR 0028, ADR 0029 | supersedes in part | The roster's **Manage** button is renamed **Edit content**. Remove player gets ❌ in place of 👢. |
| ADR 0048 | supersedes in part | Party headings use 👥 in place of ⚔️ and 🛡️. The selection note moves under Your time. |
| FR-043, FR-062 | consistent | The calendar gets dividers. Nothing else changes. |
| FR-073, ADR 0039 | consistent | Presets get an Edit flow and store the slot mode. |
| NFR-004, NFR-007 | consistent | Slot validation stays pure, in `src/domain/`. |
| Phase | MVP, unlocked | |

## Goals, non-goals, anti-goals

**Goals**

- A host can write a roster as `Weapon (Duty)` lines on any content, normal or CTA.
- A roster never holds a role outside Tank, DTank, Healer, Support, DPS, or a weapon outside the game list.
- An admin can change a saved preset without remaking it.
- The host can always place an applicant in an open position.

**Non-goals**

- No mixing of roles and weapons in one content.
- No change of mode after creation.
- No rewriting of old rosters or presets that hold unusual terms.
- No role inferred from a weapon.

**Anti-goals** (failure even if it works)

- Weapon mode spread as `if (mode === "weapon")` branches through the code, instead of one place that decides how a slot is labelled.
- A fake role stored for weapon slots.
- Old content or presets that break or show differently after release C.

## Release A: an applicant whose position is filled can still be placed (bug)

**Reproduced on 2026-11-22**, on develop at 0.31.10, with a throwaway handler test against the test database.

1. Event in selection mode. A and B both apply for position 2.
2. The host accepts A into position 2.
3. In Review applicants, B still shows `Applied: #2`.
4. Picking B gives "No open position suits what B asked for", with no position menu.
5. Assign player's member picker gives the same answer for B.

The missing weapon in the owner's report does not matter: the same thing happens with a weapon.

**Root cause.** `panel()` in `src/handlers/fill.ts` filters the open positions with `fillMatches(pref, slot)`, using the applicant's (or fill's) stored preference. Position 2 is filled, so nothing matches and the menu is not shown. The preference was meant to guide the host, not to stop them.

**Fix (owner's choice: open positions only, taken positions never shown).**

- For a chosen applicant or fill, the position menu lists every open position in that party.
- Positions that match their preference come first, each with the description `Asked for`.
- The panel text says "positions they asked for come first". When none of those are open, it says "the position they asked for is taken, pick another".
- The Review applicants option description shows `Applied: #2 (taken)` while every position the applicant named is filled. A preference by role (Healer) or Any is never marked taken.
- The automatic fill seating (`pickFillSlot`) does not change. It still follows the preference strictly.

**Tests first** (`tests/handlers/selection.test.ts`):

- The reproduction above. After A is accepted, picking B shows a menu with positions 1 and 3, and B can be placed in 3.
- The positions they asked for come first.
- `(taken)` appears in the description.
- Assign player has the same behavior for a fill whose positions are all filled.

## Release B: small changes

| # | Change | Where | Notes |
|---|---|---|---|
| B1 | **Tracking** in PvE, icon 🐾 | `src/domain/kinds.ts` | Left out of PvX (owner, 2026-11-22). Add `tracking` to `PVX_LEFT_OUT`. |
| B2 | **Skirmish** removed from PvP | `kinds.ts` | Moved to `LEGACY_KINDS`, so old posts keep the label. PvX loses it too, which frees one of the 25 menu options. |
| B3 | ZvZ: add **Territory Attack** (🗡️), merge Outpost and Castle into **Outpost & Castle** (🏯) | `kinds.ts` | New ids `territory-attack` and `outpost-castle`. The ZvZ `outposts` and `castle` entries move to `LEGACY_KINDS` (type `zvz`). PvP keeps Outpost and Castle (owner said "in ZvZ"). |
| B4 | Party headings use 👥 | `PARTY_ICONS` in `src/render/roster.ts` | Same icon as the creation card's party blocks. Bombers keeps 💣. |
| B5 | The selection note moves under Your time as a small line: `-# 🎯 Host picks the party: apply, and the host accepts you.` | `renderHeader` in `roster.ts` | Shown only for selection content, as today. |
| B6 | "Assign player" becomes **Add player** (✍️ kept). Remove player gets **❌** | `manage-panel.ts`, `help.ts`, `fill.ts` texts | Every text that names them, help included. |
| B7 | The roster button **Manage** becomes **Edit content** (🛠️ kept). The panel heading becomes "🛠️ **Edit this content.**" | `roster.ts` (three places), `manage-panel.ts`, every "Press **Manage**" and "Manage →" text | The inner **Edit details** button keeps its name. The custom id `mg:` does not change, so old rosters keep working. |
| B8 | Calendar dividers: one between the CTA events and the other content of a day, one between **Live now** and the upcoming days | `renderSchedule` in `src/render/schedule.ts` | A Components V2 separator (`type 14`, `divider: true`) between text blocks. The `Call to arms` and `Content` labels stay. Message parts become a list of text blocks and separators, and each separator counts toward Discord's component limit (checked by `discordProblems`). |
| B9 | **Edit preset** | See below | Migration 0035. |

**B3 icon.** 🗡️ is unused in ZvZ. PvP Gank Squad uses it, but icons only need to differ within one type's menu. ⚔️ is avoided because it is the PvP type icon.

**B9 Edit preset.**

1. The Manage presets panel (admins only, as today) gets an **Edit preset** button next to Save and Delete. It opens a menu of the presets for this card (normal or CTA, FR-073).
2. Picking one loads it into the card, the same as the Preset menu does. The card remembers it is editing that preset (`slot_draft.editing_preset_id`, migration 0035), and the card shows `✏️ Editing preset **Name**`.
3. While editing, the admin button reads **Save preset** in place of Save as preset. It opens the name form filled with the current name.
4. Submitting updates that preset by id: its name, slots and settings. A new name that another preset of the same kind uses is refused, with the same message as today.
5. The checks are the ones Save as preset uses today: the card must be valid for Create (owner decision 2026-11-07).
6. Loading another preset, or the preset being deleted, ends edit mode. Create still works while editing, and it does not change the preset.

## Release C: slot modes and strict slot terms

### The data model

- `content.slot_mode text not null default 'role' check (slot_mode in ('role','weapon'))`. Every existing content becomes `role`.
- `slot_draft.slot_mode`, with the same check and default, for the card.
- In weapon mode a slot has `role = null` and a non-empty `weapon`. The `slot.role` column is already nullable.
- `wait_role` (waitlist) and `fill_roles` (fills and applicants) keep their columns. They hold the slot's **label**: its role in role mode, its weapon in weapon mode. No new table.
- The preset's settings JSON gains `slotMode: "role" | "weapon"`. A missing value reads as `role`, so older presets need no change and no migration.
- Migration 0036 (0035 is Edit preset in release B).

### The label: one place decides

- New pure module `src/domain/slotlabel.ts`: `slotLabel(slot, mode)` returns the role in role mode and the weapon in weapon mode, and `labelIcon(slot, mode)` returns the role icon or the weapon emoji.
- Code that groups, matches or names slots by role calls these instead of reading `slot.role`:
  - the waitlist (per label)
  - fill and applicant matching (`fillMatches`, the fill menu's `r:` values)
  - `planSlotEdit` (pairs by label)
  - menus and announcements
  - attendance descriptions
- `RosterView` and the draft carry `slotMode`.
- Healer priority (`pickFillSlot`) applies only in role mode. In weapon mode a fill takes the lowest open position that matches.
- Ordering: in weapon mode positions stay in the typed order. `sortPositions` already does this, because a null role ranks after the five roles and the sort is stable. Add a test so it stays that way.

### Typing slots

- `parseSlots(input, mode)` in `src/domain/parse.ts`:
  - **Role mode:** `Role`, `Role (Duty)`, `Role - Weapon` or `Role - Weapon (Duty)`, as today, with two new checks:
    - The role must be one of Tank, DTank, Healer, Support, DPS. It is matched without regard to capitals and stored as written in that list, for example `healer` is stored as `Healer`.
    - The weapon, if given, must be a weapon name from `WEAPONS` (`src/data/weapons.ts`, 155 entries, off-hands included), matched the same way and stored with the list's spelling.
  - **Weapon mode:** `Weapon` or `Weapon (Duty)`. The weapon is required and checked the same way. A line with ` - ` in it is refused with "This content's slots are by weapon: write `Great Axe (Caller)`."
- Errors name the line and, for a near miss, up to three suggestions from `searchWeapons`, for example `"Grt Axe" on line 3 is not a weapon. Did you mean Great Axe?`. A bad role lists the five roles.
- `parseCtaSlots` stops checking roles itself. It calls `parseSlots` with the mode.
- `formatSlotLines(slots, mode)` writes the lines back in the mode's format, for the edit forms.

**Where the checks apply.** Every path that writes slots goes through `parseSlots` or the same term check:

- the card's typed slots
- Party 1 and Party 2 slot forms
- the Roles builder
- Edit details on a live roster, including party forms
- Save preset and Save as preset
- Fix and retry
- Set weapon (`set-weapon.ts`)

**Old content (my call).** In Edit details, a line that equals an existing slot of that roster exactly is accepted even if its terms are unusual. A host can then add one line to an old roster without fixing every other line. New or changed lines are always checked. A preset with unusual terms loads into the card as typed text that does not parse, so the card lists the problems, the same way it does for typed slots.

### The card

- A **Slots by** menu on the creation card, normal and CTA alike, with **Role** (default) and **Weapon**. It sits with the other setup menus. If the card's message is over Discord's limit of five action rows, the builder may put it in the Details step, as long as it is chosen before the slots.
- Switching mode clears the card's slots and typed text, with the note `Slots cleared: they were written by role.` (or `by weapon.`). Converting slots between modes would guess.
- Labels and examples follow the mode: "Slots (one per line: Role - Weapon)" with example `Tank - Great Axe`, or "Slots (one per line: Weapon)" with example `Great Axe (Caller)`.
- Loading a preset sets the mode from the preset.
- In weapon mode the **Roles** builder skips the role step and starts at the weapon class. The weapon is required. Duty works as today.
- The mode is fixed after creation. Edit details uses the content's mode and does not offer the menu.

### The roster

- Weapon mode row: `n. <weapon emoji> Weapon - Player - DutyIcon Duty`, and `Open` for an empty position. The rest is unchanged.
- Position menus: `n. Weapon - Duty`, with the weapon emoji.
- Waitlist: "Join the waitlist for a full weapon", with options such as `Great Axe (all taken)`. The waitlist line shows `(Great Axe)`.
- Fill menu: weapons listed where roles are today. "Any" and positions work as today.
- There is no weapon picker after joining, and `/content me` offers no **Change weapon**, because every slot already has a weapon.

## Approaches considered (weapon mode)

| | Approach | Trade-off | Outcome |
|---|---|---|---|
| A | Recognise a single-name line as a weapon when it matches a weapon name | Roles and weapons mix in one content, and no switch is needed. Guessing is implicit, and a role named like a weapon would flip. | Not chosen |
| B | A typed marker for weapon lines (`* Great Axe`) | No guessing, but members must learn the symbol. | Not chosen |
| C | A per-content switch, Role or Weapon | Clean data model and one label rule. No mixing, and one more control on the card. | **Chosen by the owner, 2026-11-22**, "for a better and cleaner data model and implementation design" |

## Constraints

- Free tiers only. No new dependency.
- Domain logic stays pure (NFR-007).
- Restricted mentions everywhere (FR-018).
- Each interaction is answered within 3 seconds (NFR-002). Weapon lookup is an in-memory list of 155, so it is fast enough.
- The tooling runs in Docker (ADR 0006).
- Git flow (ADR 0014): `hotfix/applicant-taken-position` from main for release A, then `feature/batch-2026-11-22` and `feature/slot-modes` from develop.

## Left to the builder

- Exact wording of new notes and errors, in the style of the existing ones.
- Where the **Slots by** menu sits on the card, within Discord's row limits.
- The icon for Tracking (🐾 proposed).
- The order of tasks inside each release, as long as tests come first.

## My calls (for the owner to check)

1. Release A also marks `(taken)` on the applicant and puts the positions they asked for first.
2. Release A leaves the automatic fill seating strict.
3. Territory Defense stays as is. Outpost and Castle stay separate under PvP.
4. Edit preset keeps the rule that the card must be valid for Create.
5. Switching mode clears the card's slots.
6. In Edit details, unchanged old lines are accepted, so old rosters stay editable.
7. Weapon names are matched without regard to capitals and stored with the game's spelling.
8. The roster button is renamed **Edit content**, and the inner **Edit details** keeps its name.
