---
title: Fills with preferences, no reserved seats; selection mode
type: decision
status: accepted
date: 2026-11-06
tags: [signup, fill, waitlist]
satisfies: [FR-057, FR-058]
---

# 0035: Fills with preferences, no reserved seats; selection mode

## Context
A fill holds a seat with no position (FR-032, FR-040) and the host places them by hand. The owner asked (2026-11-06) for fill for chosen roles or positions, automatic placement with healers first, a fill option for waiting players, and content where the host picks the party.

## Decision
- **Fill becomes a waitlist entry with preferences** (Any, roles, or specific positions, stored as role names and slot IDs). Joining seats the player at once in the first open matching position (Any: Healer, Tank, DTank, Support, DPS); otherwise the player waits and the existing promotion seats them when a match frees up. Every fill seating is announced in the thread (what they asked for, where they landed).
- **Reserved seats are dropped** (supersedes FR-040 and the Assign fill of FR-032). The host moves players with Manage. A waiting player may choose Fill (supersedes that part of ADR 0028).
- **Selection mode** is a per-content toggle, not a category. Signing up is an application that holds no seat; the host accepts (assign logic) or declines in a Review applicants panel; the post says so.
- Rejected: keeping reservations and assigning fills at lock time (more rules, same manual outcome).

## Consequences
- Simpler counting: the party is the seated players.
- A fill who joins first takes the first matching position, even where the host would have chosen differently; the host can move them.
- Migration needed for the stored preferences and the applicant status.
