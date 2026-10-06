---
title: Loot vote closes 5 minutes before the start, enforced at click time
type: decision
status: accepted
date: 2026-10-06
tags: [vote]
satisfies: [FR-008, NFR-005]
---

# 0005: Loot vote closes 5 minutes before the start, enforced at click time

## Context
The owner wants the vote closed 5 minutes before the content starts, with the result shown before it starts. The scheduler is only precise to a few minutes (see 0002).

## Decision
Votes are accepted only while `now < starts_at - 5 minutes`, checked in the vote handler. The scheduled job posts the result afterward. Only signed-up players vote, one vote each, changeable until the cutoff, with counts shown and not who voted. A tie is reported as a tie.

## Consequences
- The cutoff is exact. The visible result can lag, possibly past the start under option A. Anyone interacting after the cutoff sees the result immediately.
- CHK-005 measures the lag. If it is too late, switch the scheduler (see 0002).
