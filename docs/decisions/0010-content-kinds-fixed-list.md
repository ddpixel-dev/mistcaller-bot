---
title: Content kinds are a fixed list in code
type: decision
status: accepted
date: 2026-10-07
tags: [content, kinds]
satisfies: [FR-023]
---

# 0010: Content kinds are a fixed list in code

## Context
The owner asked for kinds of PvP and PvE content, each with its own label and color (Q18). FR-023 first proposed a list configurable per server.

## Decision
The list is fixed and lives in code for now, per forum type. The owner chose all candidates on 2026-10-07 and added Skirmish and Training.
- PvP: ZvZ, Small-scale, Hellgate, Faction Warfare, Crystal League, Arena, Skirmish, Training, Other.
- PvE: Group dungeon, Avalonian dungeon, Mists, Corrupted dungeon, World boss, Fame farming, Avalonian gold chest (added 2026-10-09), Other.

Hellgate is one kind (team size is already given by the slot count). The kind is optional at creation and defaults to Other.

## Consequences
- Changing the list is a code edit and a deploy. A per-server editable list is dropped from the MVP and may come back later.
- Each list fits one select menu (25 options).
- Supersedes the "configurable per server" part of FR-023.

## Update 2026-10-08
Gank Squad and Bomb Squad were added to the PvP list at the owner's request. The list is still fixed in code.
