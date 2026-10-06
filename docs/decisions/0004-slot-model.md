---
title: One line per slot, maximum 20, selected from a menu
type: decision
status: accepted
date: 2026-10-06
tags: [roster]
satisfies: [FR-003, FR-005]
---

# 0004: One line per slot, maximum 20, selected from a menu

## Context
The roster must show each position with its own player. A slot is a role plus a weapon (for example `Tank - Axe`). The gear tier applies to everyone and is not part of a slot. Discord select menus hold at most 25 options.

## Decision
Each slot is typed on its own line. A repetition shorthand (`xN`) was considered and then rejected by the owner. A content has at most 20 slots, so the menu fits within Discord's limit. Players pick from a select menu and leave with a button.

## Consequences
- A guild comp of larger content (for example ZvZ) is not supported in v1.
- Three identical positions are three typed lines, each its own row with a separate player.
