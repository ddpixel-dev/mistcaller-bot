---
title: A bot-made post is named with the date and time
type: decision
status: accepted
date: 2026-11-08
tags: [create, forum]
satisfies: [FR-068, FR-053]
---

# 0043: A bot-made post is named with the date and time

## Context
Posts the bot creates were named after the title only (ADR 0032), so several events with the same title were hard to tell apart in the forum list. The owner chose `Title | 12 Nov | 20:00 UTC` (2026-11-08).

## Decision
- The name is the title, then ` | `, the day and month (no leading zero on the day), ` | `, the start as `HH:mm`, and ` UTC`. All in UTC.
- Discord allows 100 characters, so only the title is cut; the date and time always fit.
- The post is renamed when the title or the start changes (it followed only the title before). A refused rename keeps the old name and the reply explains the two-renames-per-ten-minutes limit.
- The roster and the calendar keep showing the plain title. Posts that already exist are not renamed until their next edit.

## Consequences
- Supersedes the title-only naming of ADR 0032. `src/domain/postname.ts` holds the one function.
