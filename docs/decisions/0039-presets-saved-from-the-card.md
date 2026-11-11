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
- One **Manage presets** button sits beside Blank template. It opens a panel in the same message (the card is replaced; **Back to the card** returns, redrawn with the current presets) with **Save as preset** and **Delete preset**. Discord buttons have no tooltips, so the panel's text says what each does.
- **Save as preset** is lit only when the card passes the same checks as Create (the panel lists what is missing otherwise), and the checks run again when the name form is sent.
- **Delete preset** is lit only when the server has presets. It shows a menu of them; picking one asks to confirm (Delete or Keep it), and only then deletes.
- Only admins may use any of it: an admin role from `/content setup`, Manage Server or Administrator (the same test as the setup). Opening the panel and every step are checked.
- A preset keeps the type, category, loot vote, sign-up mode, title, gear tier, notes, build link and slots. It does not keep the start time. Older presets have no settings and fill only the slots.
- The **Choose from preset** menu is the first menu on the card. Picking one sets all of the above at once; a category that does not fit the type goes back to Other. The menu is always shown, and dimmed when the server has none.
- Saving under a name that exists (any case) replaces that preset. A server still holds 25 presets at most; a full server can only replace.
- `/content preset` (save, list, delete) and its name autocomplete are removed (supersedes the command side of ADR 0012 and FR-025).

## Consequences
- Migration 0029 adds `settings` to `slot_preset`.
- A deleted preset can stay in an open card's Preset menu until it is redrawn; picking it says the preset no longer exists.
- Supersedes "pick one in the first create form" wording in older docs.

## Update 2026-11-11
Changed by [ADR 0047](0047-cta-one-message-in-channel-bombers.md): presets carry a CTA flag; the CTA card lists only CTA presets and Plan Content only normal ones, each with its own cap of 25.
