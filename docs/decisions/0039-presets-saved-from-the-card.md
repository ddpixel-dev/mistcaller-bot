---
title: Presets are saved from the creation card and keep the whole card
type: decision
status: accepted
date: 2026-11-07
tags: [create, presets, permissions]
satisfies: [FR-025, FR-054]
---

# 0039: Presets are saved from the creation card and keep the whole card

## Context
Saving a preset needed `/content preset save` typed inside a post that already had content, which the owner found painful (2026-11-07). The owner asked for a button on the creation card, for admins only, and for presets to hold everything so that picking one fills the whole card.

## Decision
- **Save as preset** is a button beside Blank template. It is dimmed until the card passes the same checks as Create, and those checks run again when the form is sent. It opens a form with one field, the preset name.
- Only admins may use it: an admin role from `/content setup`, Manage Server or Administrator (the same test as the setup). The click and the form are both checked.
- A preset keeps the type, category, loot vote, sign-up mode, title, gear tier, notes, build link and slots. It does not keep the start time. Older presets have no settings and fill only the slots.
- The **Choose from preset** menu is the first menu on the card. Picking one sets all of the above at once; a category that does not fit the type goes back to Other. The menu is always shown, and dimmed when the server has none.
- Saving under a name that exists (any case) replaces that preset. A server still holds 25 presets at most; a full server can only replace.
- `/content preset` (save, list, delete) and its name autocomplete are removed (supersedes the command side of ADR 0012 and FR-025).

## Consequences
- Migration 0029 adds `settings` to `slot_preset`.
- There is no way yet to delete a preset: a full server must replace one. Recorded in the open questions.
- Supersedes "pick one in the first create form" wording in older docs.
