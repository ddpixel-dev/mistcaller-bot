---
title: The first create form; weapon and slot commands removed
type: decision
status: accepted
date: 2026-10-24
tags: [create, guided, commands, roster]
satisfies: [FR-052, FR-003, FR-024, FR-025, FR-026, FR-045, FR-004]
---

# 0031: The first create form; weapon and slot commands removed

## Context
`/content create` opened a private panel (type, category, loot vote, preset), then Continue asked for the number of players in a pop-up, then the slot cards, then the final form. The owner asked (2026-10-24) to enter the gear tier at the start, to choose the number of players without a separate pop-up, and to start directly with a form: one form with all the initial data, then the slot cards, then the final form. The owner also agreed to remove `/content weapon` and `/content slot`, and to change the Type line icon, which matched the title icon of Small-scale and PvP Other.

## Decision
- **First form** (FR-052): `/content create` opens a form at once with five fields: **Type and category** (one menu: the PvP categories, the PvE categories, PvP · Other, PvE · Other and PvX; a form cannot change one menu from another, so the type and the category share one), **Players needed** (1 to 20, optional), **Preset** (optional, only when the server has presets), **Gear tier** (free text, up to 80 characters) and **Loot vote** (Off or On). A form holds five fields at most, so nothing else fits. PvX starts without a category; Manage, then Edit, can set one.
- **Then**: without a preset the slot cards start at once, sized to Players needed (without a number the first card asks for it). With a preset its slots are loaded and an **Open form** button opens the final form, because a form cannot open another form. Back on the first card reopens the first form with the choices kept.
- **Final form**: the Gear Tier starts as typed in the first form, the Title as the post's name (FR-050). The gear tier travels in the slot-card draft (migration 0022, `slot_draft.gear_tier`).
- The create panel is removed; a click on an old panel says to run `/content create` again.
- **`/content weapon` and `/content slot` are removed.** Every weapon class has at most 18 weapons, so the class and weapon menus reach every weapon; the typed search is no longer needed.
- **Type line**: `🏷️ Type` instead of `⚔️ Type`.

## Consequences
- Migration 0022; two commands removed (re-register).
- Menus inside forms (Discord's Label component) are recent; the tests check the form against Discord's rules, but it is verified live by the owner.
- A typed weapon that is not in the game data can still be written in the final form's slot lines.
