---
title: The roster is a Components V2 message with a Leave button on each player's row
type: decision
status: accepted
date: 2026-10-07
tags: [roster, discord, ux]
satisfies: [FR-004, FR-005, FR-022, FR-026]
---

# 0018: The roster is a Components V2 message

## Context
The owner wanted: a join control that lists only the open positions (Option E), a Leave button tied to each player, rows in the form `Role - WeaponIcon Weapon - Duty · Sworn: Player`, and the loot vote result on the same line as the vote. A classic message shares one set of controls between all viewers and has no per-player control, and embeds cannot hold a button on a row.

Discord's Components V2 (flag `1 << 15`; docs.discord.com/developers/components/reference) gives a Section: up to three text blocks plus one button on its right. A V2 message holds at most 40 components in total, cannot carry embeds or message content, and the flag cannot be added or removed after a message is sent. Nothing in V2 is visible or enabled per viewer.

## Decision
- Each roster is one V2 message: a Container (accent colour from the category, grey when cancelled or done) holding a header text block, the rows, a menu, and the vote buttons.
- A sworn row is a Section whose button is that player's own **Leave**; only that player can use it (anyone else gets a private refusal). Open rows share one text block. Join is a single menu of the **open positions only**, so a taken position disappears from it.
- This costs 3 components per sworn row (Container 1, header 1, menu 2, votes 3), so it fits up to **11 positions**. Parties of **12 or more** keep all rows in one text block with one shared Leave button (dimmed while nobody is signed up). `/content me` stays for everyone.
- Weapon icons are inline application emoji (ADR 0017). The text is kept under Discord's 4,000 characters by dropping the icons, then the notes, then rows, only if needed.
- Rosters posted before this layout cannot be converted (the flag is permanent). Their controls answer with a short explanation and change nothing.
- A test helper (`tests/helpers/discordLimits.ts`) checks every message we send against Discord's rules: component and row counts, button and menu sizes, text lengths, unique ids and real emoji.

## Consequences
- Supersedes the per-position buttons of 0.7.0 to 0.9.0 (FR-005) and the embed theme (FR-022), which becomes container colour, text and rules.
- Old rosters stop being interactive; the owner cancels and recreates them.
- Row numbers stay in front of each row so `/content duty position:<n>` keeps working.
