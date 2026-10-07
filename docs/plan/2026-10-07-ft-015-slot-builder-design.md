---
title: FT-015 slot builder and presets design
type: plan
status: active
date: 2026-10-07
---

# FT-015: slot builder and presets

Satisfies FR-024, FR-025, FR-026. Decisions: ADR 0004 (slot model), 0009 (weapon data), 0012 (preset permissions), 0013 (icons by link). Built in three phases, each releasable on its own.

## Phase 1: presets (FR-025)
- Table `slot_preset (id, guild_id, name, slots jsonb, created_by, created_at)`, unique per guild on the lower-cased name, row-level security on, anon access revoked. At most 25 per guild.
- `/content preset save <name>` saves the slots of this post's content. Any definition mode produces a content, so this covers typed lines now and the guided steps later. `/content preset list` shows them. `/content preset delete <name>` removes one. Save, replace and delete are for Manage Server and the officer role only (ADR 0012). Saving a name that exists asks for a different name.
- `/content create preset:<name>` opens the usual form with the slots box already filled from the preset, so the officer adjusts it. The `preset` option uses autocomplete over the guild's preset names.

## Phase 2: weapon data and search (FR-026, ADR 0009)
- A script reads the weapon category of `ao-bin-dumps` and stores weapon id, display name, class and a base id (tier and enchant stripped) in a `weapon` table with its source and fetch date. The bot reads only this table.
- A weapon is found by typing part of its name in a small form. The result is a menu of up to 25 matches. Icons are links to the render service built from the item id in the adapter (ADR 0013); where Discord can show them (a thumbnail in the builder) is checked with a real test message.

### Spike result (2026-10-07)
- `formatted/items.txt` (1.1 MB, lines like `  3: T4_2H_TOOL_TRACKING : Adept's Tracking Toolkit`) is enough: no need for the 94 MB localization file.
- Weapons are ids matching `T<n>_(MAIN|2H|OFF)_*` without `@` (enchant). After dropping 15 `_TOOL_` items there are 155 base weapons: 35 one-handed, 102 two-handed, 18 off-hands, with 155 distinct names once the tier word ("Adept's ", "Master's " and so on) is removed.
- The render service answers 200 for tiered ids such as `T4_MAIN_SWORD` and 404 for ids without a tier, so the icon id is `T4_<base>` (or the lowest tier that exists).
- Files fetched for the spike stay outside the repo.

## Phase 3: guided steps (FR-024)
- `/content create mode:guided` starts a draft saved in the database (no memory state): the member count, then for each slot a role menu and a weapon search, with "same as previous" and "fill the rest". The draft ends as the same slot list, at most 20, handed to the usual create form.
- Drafts expire after one hour and are cleaned by the scheduled job.

## Limits to remember
- A roster line cannot carry an image. Per-line weapon icons are not possible in Discord embed text, so the roster shows the role icon and the weapon name; icons live in the builder.
- Autocomplete answers within the same 3-second limit and reads only the preset table.
