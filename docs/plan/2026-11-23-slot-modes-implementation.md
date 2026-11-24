# Slot modes and strict slot terms: implementation plan (release C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** FR-076, slots by Role or Weapon on every content, and FR-077, strict roles and weapons, as release 0.32.0.

**Architecture:**
- A slot in weapon mode has an empty role in memory and `null` in the database, plus a required weapon.
- One pure function decides the slot's label: `slotLabel(s) = s.role || s.weapon`. Every place that groups, matches or names slots uses it, so the waitlist, fills, menus and slot edits work for both modes without branches.
- Ordering, healer priority and the "pick your weapon" step already behave correctly for a slot with no role and a weapon, because a role-less slot ranks last, is never a healer, and has a weapon. Tests pin this.
- The mode is stored on the content and the card. It decides only how lines are typed, checked, written back and labelled in forms.

**Tech Stack:** TypeScript on Node 24, run with `node --test` in Docker. Postgres 16.

**Spec:** [2026-11-22-slot-modes-and-batch-design.md](2026-11-22-slot-modes-and-batch-design.md), section "Release C".

**Branch:** `feature/slot-modes`.

## Global Constraints

- Run every tool in Docker. Write each test first and watch it fail. Domain logic stays pure (NFR-007).
- The five roles are `Tank, DTank, Healer, Support, DPS` (`GUIDED_ROLES`). Weapons come from `WEAPONS` (`src/data/weapons.ts`), off-hands included. Both are matched without regard to capitals and stored in the list's spelling.
- A line equal to an existing slot of that roster (role, weapon, duty) is accepted unchecked, only in Edit details.
- Custom ids of posted messages do not change.

## Review Focus

1. A role-mode line whose weapon is a near miss, such as `Tank - Grt Axe`. The error names the line and suggests Great Axe (Task 1).
2. A weapon-mode waitlist. A weapon whose positions are all taken can be waited for, and a freed seat goes to the first waiter (Task 3, in the database).
3. A weapon-mode fill choosing a weapon. The fill menu lists weapons, and seating matches by weapon (Task 3).
4. Edit details on an old roster with unusual terms. Adding one line works, and changing an old line to an unusual term is refused (Task 5).
5. A preset saved before this release. It loads as Role mode, and unusual terms show as card problems (Task 4).

---

### Task 1: Domain: label, strict terms, parse and format by mode

**Files:** create `src/domain/slotlabel.ts` and `src/domain/terms.ts`. Modify `src/domain/types.ts`, `parse.ts`, `slots.ts`, `parties.ts`, `fillmatch.ts` and `card.ts`. Test: `tests/domain/slotlabel.test.ts`, `terms.test.ts`, `parse.test.ts`, `slots.test.ts` and `fillmatch.test.ts`.

**Interfaces (produced):**
- `type SlotMode = "role" | "weapon"` and `isSlotMode(v): v is SlotMode`, in `types.ts`.
- `slotLabel(s: { role: string; weapon: string }): string`, which is `role || weapon`.
- `slotText(s: { role: string; weapon: string; duty?: string | null }): string`, for menus: `"Tank - Mace"`, `"Tank"` or `"Great Axe"`, without the duty.
- `canonicalRole(t: string): string | null` and `canonicalWeapon(t: string): string | null`.
- `weaponHint(t: string): string`, which is `" Did you mean A, B or C?"` or `""`.
- `parseSlots(input: string, mode: SlotMode = "role", existing: SlotDef-like[] = []): Result<SlotDef[]>`.
- `formatSlotLines(slots)`, which writes `Weapon (Duty)` for a slot with no role.
- `parseCtaSlots(input, party, parties, existing = [], mode = "role")` calls `parseSlots` and prefixes `Party n, ` to the error when there are two parties.
- `fillMatches(pref, slot)` and `planSlotEdit` match by `slotLabel`.
- `validateCard` reads `CardInput.slotMode` and checks stored slots with `parseSlots(formatSlotLines(stored), mode)`.

**Test assertions:**
- `parseSlots("tank - great axe (caller)")` gives `[{ role: "Tank", weapon: "Great Axe", duty: "caller" }]`.
- `parseSlots("Off-Tank")` fails with `Line 1: "Off-Tank" is not a role. Use Tank, DTank, Healer, Support or DPS.`
- `parseSlots("Tank - Grt Axe")` fails with a message that includes `Line 1: "Grt Axe" is not a weapon.` and `Great Axe`.
- `parseSlots("Great Axe (Caller)\nHallowfall", "weapon")` gives `[{ role: "", weapon: "Great Axe", duty: "caller" }, { role: "", weapon: "Hallowfall" }]`.
- `parseSlots("Tank - Mace", "weapon")` fails with a message that includes `slots are by weapon`.
- `parseSlots("Tank", "weapon")` fails with `"Tank" is not a weapon`.
- `parseSlots("Raider - Holy", "role", [{ role: "Raider", weapon: "Holy", duty: null }])` succeeds, and the same without `existing` fails.
- `formatSlotLines([{ role: "", weapon: "Bow", duty: "scout" }])` gives `"Bow (Scout)"`.
- `slotLabel({ role: "", weapon: "Bow" })` is `"Bow"`. `fillMatches({ any: false, roles: ["bow"], slotIds: [] }, { id, position: 1, role: "", weapon: "Bow" })` is true.
- `pickFillSlot` with Any over a weapon slot and a role Healer slot picks the Healer first. Over two weapon slots it picks the lowest position.
- `planSlotEdit` renames an empty `Bow` slot when the new line is `Bow (Scout)`.
- `sortByRole` keeps weapon slots in their typed order after the role slots.
- Existing CTA tests: the role error text changes to the new wording. Update them.

- [ ] Write the tests, see them fail, implement, run the whole suite, and fix tests that typed weapons not in the list (such as `Holy`) by using list names. Commit with message `feat: strict roles and weapons, and slots by weapon in the slot parser (FR-076, FR-077)`.

### Task 2: Database: slot mode on content, card and preset

**Files:** create `supabase/migrations/0036_slot_mode.sql`. Modify `src/db/content.ts` (`NewContent.slotMode`, insert, `getRosterView`), `src/db/draft.ts` (`slotMode`), `src/db/preset.ts` (`PresetSettings.slotMode`, `toSettings`), `src/db/manage.ts` (renames store `role || null`) and `src/domain/types.ts` (`RosterView.slotMode: SlotMode`). Test: `tests/db/content.test.ts`, `draft.test.ts` and `preset.test.ts`.

Migration:
```sql
alter table content add column slot_mode text not null default 'role' check (slot_mode in ('role', 'weapon'));
alter table slot_draft add column slot_mode text not null default 'role' check (slot_mode in ('role', 'weapon'));
```

**Test assertions:**
- `createContent` with `slotMode: "weapon"` and slots `[{ role: "", weapon: "Bow" }]` stores `slot.role` as null, and `getRosterView` gives `slotMode: "weapon"` and `role: ""`.
- Existing content reads `slotMode: "role"`.
- The draft saves and reads `slotMode`, and `startCard` resets it to `role`.
- `toSettings({...})` without `slotMode` gives `slotMode: "role"`.
- Planning a rename to a weapon slot stores `role` as null.

- [ ] Run the cycle. Commit with message `feat: slot mode on content, card and presets, migration 0036 (FR-076)`.

### Task 3: Everything that names, groups or matches slots uses the label

**Files:**
- `src/db/signup.ts`: `joinWaitlist` matches `lower(coalesce(s.role, s.weapon))`. Promotions, open slots and fill seating use the label.
- `src/render/roster.ts`: the weapon-mode row `n. <emoji> Weapon - Player - Duty`. Menus use `slotText`. The waitlist menu uses labels, with the placeholder `Join the waitlist for a full weapon` in weapon mode.
- `src/render/theme.ts`: `slotIcon(s)`, the role icon or 🔹. Menus keep the weapon emoji when there is one.
- `src/handlers/fill-pref.ts`: the fill menu lists labels.
- `src/handlers/fill.ts`, `duty.ts`, `me.ts`, `remove.ts`, `waitlist.ts`, `signup.ts`, `set-weapon.ts` and `src/render/attendance.ts`: use `slotText` or `slotLabel` in place of `s.role` and `s.weapon`.

**Test assertions** (`tests/render/roster.test.ts`, `tests/handlers/signup.test.ts`, `tests/db/waitlist.test.ts`, `tests/handlers/fill.test.ts`):
- A weapon-mode roster row reads `1. <bow emoji> Bow - <@u> - 📯 Caller`, and an open row reads `2. <emoji> Bow - Open`.
- The join menu option label is `1. Bow`.
- With both Bow slots taken, the waitlist menu offers `Bow (all taken)` with the placeholder `Join the waitlist for a full weapon`. Joining stores `wait_role = 'Bow'`. When a Bow holder leaves, the waiter is seated.
- In weapon mode the fill menu lists `Bow`, and a fill choosing `r:Bow` is seated in an open Bow slot.
- Joining a weapon slot shows no weapon picker.
- Every role-mode snapshot is unchanged.

- [ ] Run the cycle. Commit with message `feat: the waitlist, fills and menus work by weapon in weapon mode (FR-076)`.

### Task 4: The creation card: Slots by, typing, presets, Roles builder, Create

**Files:**
- `src/render/card.ts`: a **Slots by** menu (`cc:mode:<draft>`) after Sign-up, with options `Slots by role (Role - Weapon)` and `Slots by weapon (Weapon only)`. The slot block lines use `slotText`.
- `src/handlers/card.ts`: the `mode` action clears `slots`, `slotsText`, `slots2` and `slots2Text`, with the note from the spec. The forms' labels and placeholders follow the mode. Typed slots are parsed with the mode. Loading a preset sets the mode. Saving a preset stores it. Create passes `slotMode`.
- `src/domain/guided.ts`: `canSave(d, mode)`, `next(d, mode)` and `fillRest(d, mode)`. Weapon mode needs a weapon and stores `role: ""`. `setWeapon` accepts only `canonicalWeapon`.
- `src/render/guided.ts` and `src/handlers/guided.ts`: in weapon mode, no role menu.
- `src/handlers/create.ts` (`publish`): passes `slotMode`.

**Test assertions** (`tests/handlers/card.test.ts`, `tests/domain/guided.test.ts`):
- The card has `cc:mode`, with Role as the default.
- Picking Weapon with slots set clears them and shows `Slots cleared: they were written by role.`
- In weapon mode the Details slots label is `Slots (one per line: Weapon)` with the placeholder `Great Axe (Caller)`.
- Typing `Bow\nHallowfall (Main Healer)` and pressing Create gives a roster with two weapon slots and `slot_mode = 'weapon'`.
- The same for a CTA, in both parties.
- A preset saved in weapon mode loads in weapon mode.
- A preset with `Raider - Holy` loads, and the card lists the problem.
- In weapon mode the Roles builder has no role menu and saves `{ role: "", weapon }`.

- [ ] Run the cycle. Commit with message `feat: Slots by Role or Weapon on the creation card, presets and Roles (FR-076)`.

### Task 5: Edit details, party forms, Fix and retry, and Set weapon follow the mode and the checks

**Files:**
- `src/handlers/manage.ts`: the Edit form and party forms use the content's mode for the label and the value (`formatSlotLines`). The slots are parsed with the mode and `existing` set to that party's current slots.
- `src/handlers/manage-panel.ts`: the same labels.
- `src/handlers/retry.ts`: the label by mode, from the stored form.
- `src/handlers/set-weapon.ts`: the weapon must be `canonicalWeapon`.

**Test assertions** (`tests/handlers/manage.test.ts`, `retry.test.ts`, `duty.test.ts`):
- On a roster with `Raider - Holy`, adding a line `Tank - Mace` is accepted and the old line stays.
- Changing it to `Raider2 - Holy` is refused with the role error.
- A weapon-mode roster's Edit form shows `Bow (Caller)` lines and accepts `Bow\nBow`.
- Set weapon with `Holy` is refused, and with `Hallowfall` it is accepted.

- [ ] Run the cycle. Commit with message `feat: Edit details and Set weapon check roles and weapons, by the content's mode (FR-076, FR-077)`.

### Task 6: Help, docs, changelog 0.32.0

- [ ] `help.ts`: one line on Slots by. Check the help length limit test.
- [ ] Records:
  - `changelog/0.32.0.md`.
  - `PRODUCT.md`: FR-076 and FR-077 become built, and FR-003 gets a "changed by FR-076 and FR-077" note.
  - The current state and handoff.
  - The `docs/INDEX.md` plan entry.
- [ ] Run the full suite and typecheck. Merge into develop, then release when the owner says.
