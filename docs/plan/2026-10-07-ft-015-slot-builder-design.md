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
- Built (ADR 0015): `scripts/import-weapons.ts` writes `src/data/weapons.ts` (base id, name, class, icon tier, source and date). `/content weapon <name>` with autocomplete shows a match and its linked icon, so the icons can be checked before the guided steps use them.
- A weapon is found by typing part of its name in a small form. The result is a menu of up to 25 matches. Icons are links to the render service built from the item id in the adapter (ADR 0013); where Discord can show them (a thumbnail in the builder) is checked with a real test message.

### Spike result (2026-10-07)
- `formatted/items.txt` (1.1 MB, lines like `  3: T4_2H_TOOL_TRACKING : Adept's Tracking Toolkit`) is enough: no need for the 94 MB localization file.
- Weapons are ids matching `T<n>_(MAIN|2H|OFF)_*` without `@` (enchant). After dropping 15 `_TOOL_` items there are 155 base weapons: 35 one-handed, 102 two-handed, 18 off-hands, with 155 distinct names once the tier word ("Adept's ", "Master's " and so on) is removed.
- The render service answers 200 for tiered ids such as `T4_MAIN_SWORD` and 404 for ids without a tier, so the icon id is `T4_<base>` (or the lowest tier that exists).
- Files fetched for the spike stay outside the repo.

## Phase 3: guided steps (FR-024) - built, reworked three times on the same day
Approved by the owner on 2026-10-07 after reading the Roster Studio artifact:
- Continue in the create panel goes straight to "How many players needed?" (one number box, 1 to 20). No "how to set the slots" step. A chosen preset skips the cards and opens the filled form.
- One card per slot, "Slot k of n" with progress dots: four lists with placeholders (Role, Weapon class, Weapon, Duty). Picking a weapon class fills the weapon list with that class (at most 25). No pop-up search (owner decision); typing a name is done with `/content slot`. The Duty list has no "None" entry and can be deselected. **Next** saves the slot (Finish on the last). Back, Same as previous, Fill the rest, Change number and Cancel are on the card; Back on the first card returns to the create panel.
- `/content slot role weapon duty` fills the card in one command, with a searchable weapon autocomplete.
- Progress is in the `slot_draft` table (migrations 0005, 0007, 0008): one per member per post, replaced when restarted, purged after an hour by the scheduled job. Decisions come from pure functions in `src/domain/guided.ts`.
- The duty belongs to the slot (FR-027) and travels in typed lines as `(Caller)`.

## Limits to remember
- A roster line cannot carry an image. Per-line weapon icons are not possible in Discord embed text, so the roster shows the role icon and the weapon name; icons live in the builder.
- Autocomplete answers within the same 3-second limit and reads only the preset table.
