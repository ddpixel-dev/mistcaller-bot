---
title: The roster is a Components V2 message with an open-positions menu and a shared Leave button
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
- Each roster is one V2 message: a Container (accent colour from the category, grey when cancelled or done) holding a header text block, the rows as one text block, a menu of the **open positions only** (a taken position disappears from it), and one row of buttons: **Leave** and, with a loot vote, Split and Regear.
- **Leave is one shared button** for every party size (owner decision 2026-10-07, after a first version with a Leave button on each sworn row was limited to 11 positions by the 40-component cap). Discord cannot enable a control for some viewers only (confirmed in Discord's docs and by other roster bots, which all use a shared Join/Leave pair), so it is enabled while anyone is signed up and dimmed otherwise, and it only ever acts for a signed-up player: anyone else gets a private "You are not signed up". `/content me` keeps a private panel with a Leave button of one's own.
- At most 9 components are used, so any party size up to 20 fits.
- Weapon icons are inline application emoji (ADR 0017). The text is kept under Discord's 4,000 characters by dropping the icons, then the notes, then rows, only if needed.
- Rosters posted before this layout cannot be converted (the flag is permanent). Their controls answer with a short explanation and change nothing.
- A test helper (`tests/helpers/discordLimits.ts`) checks every message we send against Discord's rules.

## Consequences
- Supersedes the per-position buttons of 0.7.0 to 0.9.0 (FR-005) and the embed theme (FR-022), which becomes container colour, text and rules.
- Old rosters stop being interactive; the owner cancels and recreates them.
- Row numbers stay in front of each row so `/content duty position:<n>` keeps working.
