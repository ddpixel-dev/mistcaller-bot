---
title: Presets are managed only by Manage Server and the officer role
type: decision
status: accepted
date: 2026-10-07
tags: [presets, permissions]
satisfies: [FR-025]
---

# 0012: Presets are managed only by Manage Server and the officer role

## Context
Slot presets are saved and deleted by someone (Q20).

## Decision
Only members with Manage Server or the guild's officer role may save, rename and delete presets. Plain creators may use presets but not manage them. Names are unique per server, and a server holds at most 25 presets (one select menu). The owner agreed on 2026-10-07 to "specific roles only"; the exact roles and the cap of 25 were my proposal and the owner agreed.

## Consequences
- Presets need the same permission check as management actions, minus the creator.
- The cap is a constant in code, easy to raise later.
