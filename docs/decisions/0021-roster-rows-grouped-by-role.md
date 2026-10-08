---
title: Roster rows grouped under a heading per role; header columns measured
type: decision
status: accepted
date: 2026-10-08
tags: [roster, layout, alignment]
satisfies: [FR-004]
---

# 0021: Roster rows grouped by role

## Context
Padding rows with spaces (0.14.0) could not line up the role, weapon and duty columns: Discord's font is proportional and the measured error was up to about 14 px. Discord has no tables, no columns, and no way to show custom emoji or mentions inside a code block, so a monospace block would lose the weapon icons and the clickable names. The owner asked for icons to be kept, and compared eight mock-ups (docs in the session's artifact) on 2026-10-08.

## Decision (owner decision 2026-10-08, layout E)
- Rows sit under a heading per role: `### 🛡️ Tank · 1/1`, then `n. WeaponIcon Weapon - DutyIcon Duty · Sworn: Player` (or `Open`). With the role in the heading there is no role column to line up.
- Groups follow the order in which each role first appears (roles match ignoring case); rows keep their position numbers, so the join menu and `/content duty` numbers are unchanged. A cut for length never ends on a heading.
- The header keeps its labelled lines (Type, Gear tier, Loot vote, UTC, Your time). Only the header is aligned, with a fixed number of en spaces per label (6, 3, 2, 7, 2), measured from a screenshot of Discord desktop (an en space is about 6.7 px there; the measured value starts agreed within 1 px). Row padding and the width estimator are removed.

## Consequences
- The header columns are exact only for that font; another platform may differ by a few pixels.
- A roster with many different roles has many headings (one per role).
- Replaces the row padding of 0.14.0 (FR-004).
