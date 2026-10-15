---
title: Statistics by command, not by channel
type: decision
status: accepted
date: 2026-10-15
tags: [dashboards, statistics, commands]
satisfies: [FR-044, FR-045]
---

# 0027: Statistics by command, not by channel

## Context
ADR 0026 (owner request of 2026-10-15) gave each server a statistics channel with a message the bot kept up to date, next to the Events Calendar. After seeing it, the owner changed the request: no statistics channel; anyone should be able to ask for the numbers with a command, and the answer should be private.

## Decision
- **`/content stats`** (FR-044) is open to everyone and answers with a private Components V2 message (`IS_COMPONENTS_V2` plus `EPHEMERAL`). It counts only the server it is used in. The numbers and their layout are unchanged: one number per line, cancelled events and players who left a roster not counted, no no-show board.
- **The statistics channel is removed.** `/content setup` loses `statistics-channel` and `clear-statistics`; the dashboard engine, the scheduled job and the 30-minute refresh only handle the Events Calendar now. The `dashboard` table keeps its check constraint; rows of kind `statistics` are removed at release by a one-off clean-up that also deletes the messages the bot posted.
- The statistics queries run in parallel so the reply fits the 3-second limit.

## Consequences
- Commands changed (re-register): `stats` added, two `setup` options removed.
- The numbers are computed on every request (about ten small queries); at this size that is cheap.
- Statistics are visible to everyone, including the top hosts and players as mentions, but only to the member who asks.
