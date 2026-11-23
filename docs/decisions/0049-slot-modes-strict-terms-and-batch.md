---
title: Slots by role or by weapon; strict roles and weapons; Edit preset; the 2026-11-22 batch
type: decision
status: accepted
date: 2026-11-22
tags: [slots, presets, calendar, kinds, selection, roster]
satisfies: [FR-076, FR-077, FR-078, FR-079, FR-080]
---

# 0049: Slots by role or by weapon; strict roles and weapons; Edit preset; the 2026-11-22 batch

## Context

On 2026-11-22 the owner asked for:

- a second slot format, `Weapon - Player - Duty`, next to `Role - Weapon - Player - Duty`
- strict roles and weapons
- an Edit preset option
- a fix for applicants whose position was filled
- a set of small changes: categories, icons, labels and calendar dividers

Design: [docs/plan/2026-11-22-slot-modes-and-batch-design.md](../plan/2026-11-22-slot-modes-and-batch-design.md).

## Decision (agreed with the owner, 2026-11-22)

- **Slot mode per content.** Every content (normal and CTA) chooses **Role** or **Weapon** at creation. This is option C of three; the owner chose it "for a better and cleaner data model and implementation design".
  - The mode is stored on the content and is fixed after creation.
  - In weapon mode a slot has no role.
  - Everything that worked by role works by the weapon.
- **Strict terms on every content.**
  - Roles are Tank, DTank, Healer, Support and DPS only.
  - Weapons must come from the game's weapon list, off-hands included ("All").
  - This replaces the CTA-only role check (FR-070).
- **Applicants and fills.** The host's position menu lists every open position, and taken positions are never listed. Supersedes the strict filter of FR-057 and FR-058 in the host panels.
- **Categories.**
  - Tracking is added to PvE; PvX does not get it.
  - Skirmish is removed from PvP.
  - ZvZ gains Territory Attack.
  - In ZvZ, Outpost and Castle become one option, Outpost & Castle.
  - Old content keeps its label.
- **Labels and icons.**
  - Party headings use 👥, as on the creation card.
  - The host-picks note becomes a small line under Your time.
  - "Assign player" is renamed "Add player" and keeps its icon.
  - Remove player gets ❌.
  - The roster's Manage button is renamed Edit content.
- **Calendar.** A divider goes between CTA and other content, and another between Live now and upcoming.
- **Presets.** Admins can edit an existing preset from Manage presets.

## Consequences

- Release A is a hotfix with no migration.
- Release B adds migration 0035 (the card remembers the preset being edited).
- Release C adds migration 0036 (`content.slot_mode`, `slot_draft.slot_mode`). Presets keep the mode in their settings JSON.
- Old rosters and presets with unusual terms keep showing as they are.
- Supersedes in part: FR-003, FR-070, ADR 0028, ADR 0029, ADR 0041 and ADR 0048.
