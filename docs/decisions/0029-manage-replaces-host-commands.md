---
title: Manage replaces the host commands; Edit panel, Set weapon, post title
type: decision
status: accepted
date: 2026-10-24
tags: [roster, manage, commands, create, weapons]
satisfies: [FR-003, FR-029, FR-030, FR-045, FR-046, FR-047, FR-048, FR-049, FR-050]
---

# 0029: Manage replaces the host commands; Edit panel, Set weapon, post title

## Context
After 0.22.0 (ADR 0028) the owner asked (2026-10-24) to set a weapon later on a position that has none, to start the create form's title from the post's name, to drop the line of weapon icons, and to remove the commands the Manage panel already covers so members and hosts are not confused. While this was built, the owner also asked to rename Sign up player to **Add player** with a green plus, and that a host move never carries the player's own weapon pick.

## Decision
- **Commands removed**: `edit`, `cancel`, `lock`, `unlock`, `end`, `reopen`, `attendance`, `duty` and `assign`. Their handlers stay and run from the Manage panel. `create`, `list`, `me`, `weapon`, `help`, `stats`, `history`, `setup`, `preset` and `slot` remain. A removed command that still reaches the bot (a stale client) is answered with a pointer to Manage.
- **Edit panel** (FR-048): Manage → Edit opens a private panel with a Category menu and a Loot vote menu that apply at once, **Edit details** (the existing five-field form, which no longer carries a category or build marker) and **Build link** (a one-field form, filled with the current link; empty removes it). This replaces the options of the old `/content edit`. Forms opened before 0.23.0 with markers are still understood.
- **Manage on finished rosters**: a done roster keeps the Manage button, the one control not dimmed (changes FR-022), and its panel offers only Attendance and Reopen. Cancelled rosters have no Manage.
- **Set weapon** (FR-049): shown in the panel while a position has no weapon. Position (only those without a weapon), weapon class, weapon. The holder keeps the seat; a pick of their own is replaced and the post tells them, pinging only them. Allowed while open or locked. Changing a weapon that is set stays with Edit details.
- **Add player** (renamed from Sign up player): a green (success style) button with ➕; Discord has no green plus emoji. A host move clears the player's own weapon (FR-030 no longer applies to host moves): the new position's weapon applies, or the player picks again, and the post line then adds "Pick your weapon with `/content me`". A move the player makes keeps the FR-030 rule.
- **Post title** (FR-050): in a forum post or thread, the create form's Title starts as the post's name (at most 100 characters); in an ordinary channel it stays empty.
- **No party strip**: the level-1 line of weapon icons (FR-046) is removed; each position line keeps its icon.
- **Tips**: "🛠️ Press **Manage** to edit, add players, end or cancel · `/content help` for more".

## Consequences
- Commands changed: re-register. Members who type a removed command no longer find it; `/content help` points to Manage.
- No migration.
- `kindChoices` (the category choices of `/content edit`) is removed with the command.
