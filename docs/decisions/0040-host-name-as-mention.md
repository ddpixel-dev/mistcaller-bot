---
title: The host is shown as a mention, not a stored name
type: decision
status: accepted
date: 2026-11-08
tags: [roster, calendar]
satisfies: [FR-064]
---

# 0040: The host is shown as a mention, not a stored name

## Context
The owner asked for the content owner's name on the post and in the calendar (2026-11-08). The content already stores `created_by`, the creator's Discord id, and players are already shown as mentions.

## Decision
- Show the creator as `<@id>` on a `👑 Host` roster line and after the party count in each calendar event. Every message sends `allowed_mentions: { parse: [] }`, so the mention shows a name and never pings.
- Do not store a display name: there is no migration, and the name never goes stale.
- No `created_by` means no host line (never a placeholder).

## Consequences
- A viewer whose client has not loaded the user can see a raw `<@id>`. The roster already has this limit for every player.
- The calendar details line is about 30 characters longer per event; the existing size budget packs the pages.
