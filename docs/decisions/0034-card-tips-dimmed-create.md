---
title: Start back in Details, tips under the buttons, dimmed Create, kick icon
type: decision
status: accepted
date: 2026-10-24
tags: [create, card, manage]
satisfies: [FR-054, FR-048]
---

# 0034: Start back in Details, tips under the buttons, dimmed Create, kick icon

## Context
After 0.27.0 the owner asked (2026-10-24) to set the start in the Details form again instead of the card's menus, to move the card's tips under the buttons, to dim Create until the card is valid, and to give Remove player a more fitting icon.

## Decision
- **Start in Details** (supersedes the start menus of ADR 0033): the Details form holds Title, Start, Gear tier, Slots and Notes; the start begins at now plus one hour. The Day, Hour and Minute menus are removed.
- **Tips**: under the buttons, after a divider, one `💡` line each (only you see the card; set the menus, then Details; Roles builds the slots; Create lights up when ready). No tips above the menus.
- **Create** is dimmed until the card passes the same checks as creation; the card lists what is still needed, or says it is ready. A forced click is still checked on the server.
- **Remove player** uses 👢 (a kick).
- The card stays a Components V2 message (it holds the divider and the tips under the buttons).

## Consequences
- No migration, no command change.
