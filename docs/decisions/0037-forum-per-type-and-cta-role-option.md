---
title: Event forum per content type; CTA role options
type: decision
status: accepted
date: 2026-11-06
tags: [setup, forum, cta, permissions]
satisfies: [FR-053, FR-059]
---

# 0037: Event forum per content type; CTA role options

## Context
`/content setup event-forum` took a `forum-type` of Any, PvP or PvE. PvX had no choice of its own: it went to a forum for any type, else to the first forum. The owner asked (2026-11-06) to drop Any, to be able to pick the PvP forum for PvX, and to set the CTA roles with a command option instead of only through the private panel.

## Decision
- `forum-type` is **PvP, PvE or PvX** and is required with `event-forum`. There is no Any. Each type has at most one forum; setting a type again moves it to the new forum.
- One forum may serve several types: run the command again with the same forum and another type. Normal content goes to the forum set for its type and nowhere else, so a type with no forum gets a message naming the command to run (no fallback to another type's forum).
- `clear-event-forum` removes the forum from every type it serves, or from one type when `forum-type` is given too.
- `cta-role` adds one role and `remove-cta-role` removes one (a command option holds a single role, so the list is built by repeating the command). Admins only, `@everyone` refused, at most 10 roles (`MAX_CTA_ROLES`). The panel's role picker stays as another way to set the whole list.
- Migration 0028 re-keys `event_forum` to (guild, type) and converts each old row so routing stays as it was: an exact type, then an old "Any" forum, and PvX to the old "Any" forum or else the first forum.

## Consequences
- A server that relied on the PvX fallback keeps it through the migration, but any new forum needs a type for each kind of content, set on purpose.
- Supersedes the "Any" type and the PvX fallback of ADR 0032 and ADR 0036. A card opened for one forum's type now offers that type only (this path is only used by old drafts).
- Commands must be registered again (`scripts/register-commands.ts`) for the new options to appear.
