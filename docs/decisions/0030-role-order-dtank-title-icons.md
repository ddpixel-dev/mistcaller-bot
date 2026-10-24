---
title: Positions by role, DTank, category title icons, scout telescope
type: decision
status: accepted
date: 2026-10-24
tags: [roster, roles, theme]
satisfies: [FR-051, FR-024, FR-022, FT-016]
---

# 0030: Positions by role, DTank, category title icons, scout telescope

## Context
The owner asked (2026-10-24) for the roster to be ordered by role, a DTank role, nicer title icons than `📜 ⚜ Title ⚜`, and a more fitting Scout icon than the bow.

## Decision
- **Role order** (FR-051): positions are numbered 1..n by role, Tank, DTank, Healer, Support, DPS, then any other role in the order it was written (names matched ignoring case and spaces). Content is sorted when created and after every Edit details save; migration 0021 sorts the content that exists. Seats, duties and weapons belong to the slot row, so they move with it; a player's number can change. Rows are not re-sorted at render, so the number shown is always the stored one.
- **DTank** joins the guided Role menu and `/content slot` after Tank, with the icon 🧱 (Tank keeps 🛡️).
- **Title**: one icon, the category's (ZvZ 🏰, Small-scale ⚔️, Gank Squad 🗡️, Bomb Squad 💣, Ava Gank 🌑, Hellgate 🔥, Faction Warfare 🚩, Crystal League 💎, Arena 🏟️, Skirmish 🤺, Training 🎯, Group dungeon 🏚️, Avalonian dungeon 🌌, Mists 🌫️, Corrupted dungeon 💀, World boss 🐉, Fame farming 🌾, Avalonian gold chest and Ava Gold 💰), or the type's for Other (PvP ⚔️, PvE 🐉, PvX 🌀). The scroll and fleur-de-lis marks of FR-022 are dropped. A cancelled title keeps its tag.
- **Scout**: the Scout duty and a role named Scout use 🔭; bow and ranged roles keep 🏹.

## Consequences
- Migration 0021, and the `/content slot` role choices changed (re-register).
- Existing rosters show the new order when they are next rendered; the release re-renders the live ones.
- An edit maps typed lines to positions by line order, as before; the form shows the sorted order.
