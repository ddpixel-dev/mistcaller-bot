---
title: Tentative sign-up is a flag on the sign-up row
type: decision
status: accepted
date: 2026-11-08
tags: [signup, roster]
satisfies: [FR-067]
---

# 0042: Tentative sign-up is a flag on the sign-up row

## Context
The owner asked for a way to show that a signed-up player might not make it, with an emoji beside their name (2026-11-08). The join control is a select menu, which has no checkbox. The owner chose a toggle button over a choice at join time. Full design: [the design](../plan/2026-11-08-tentative-signup-design.md).

## Decision
- `signup.tentative boolean not null default false` (migration 0030). Every move between seat, fill, applicants and waitlist is an upsert that names only the columns it changes, so the flag follows the player without code in those paths; leaving deletes the row, so signing up again starts confirmed. Tests cover each move.
- One shared **❓ Tentative** button beside Leave (`tent:<content>`) flips the flag of the player who pressed it, in any list, while the content is open or locked. It answers by updating the roster, like Leave.
- ❓ shows after the name in seats, applicants, fill and waitlist, and in the host's Review applicants and Assign player menus.
- A tentative player keeps the seat, counts in the party and is still pinged. No automatic action is taken on them.
- Manage moves to a second button row, because six buttons do not fit in one.

## Consequences
- Migrate production before the code is deployed: the roster query reads the new column.
- Not built: a tentative count in the header or the calendar, and any deadline that releases a tentative seat.
