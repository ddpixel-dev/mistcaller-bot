---
title: A CTA may have two parties, one roster message each
type: decision
status: superseded in part by 0047 (2026-11-11)
date: 2026-11-10
tags: [roster, cta, zvz, parties]
satisfies: [FR-070]
---

# 0044: A CTA may have two parties, one roster message each

## Context
The owner asked (2026-11-10) for CTA content with up to two parties of 20 players each, as an experiment before ZvZ needs the same. ADR 0004 caps a roster at 20, and Discord select menus hold 25 options, a message holds 4000 characters of text and 40 components. Full design: [the design](../plan/2026-11-10-cta-pinned-message-and-parties-design.md).

## Decision
- A content has `party_count` 1 or 2, chosen at creation and fixed afterwards. `slot`, waitlist, fill and applicant rows carry a `party`. A member still holds one entry per content.
- Each party has its own roster message (`content_message`), with its own menu, buttons, fills and waitlist. Party 1's message keeps the existing message ID, so old rosters do not change.
- Fill and waitlist work per party. Position numbering by role restarts in each party.
- `maxPartiesFor(category, isCta)` is the one place that says how many parties a content may have: 2 for a CTA, 1 otherwise. ZvZ will change it.
- CTA positions are typed per party; a role outside Tank, DTank, Healer, Support, DPS is rejected for CTA.
- Host panels (Assign, Add, Remove, Set weapon, Review applicants, Edit slots, Attendance) ask for the party first.

## Consequences
- Supersedes ADR 0004 in part: the maximum of 20 slots now applies to each party, not to the whole content.
- Migration 0032 changes the unique key on `slot`; production must be migrated before the code is deployed.
- Every handler that identified a position by its number alone needs the party. The plan lists them first.
- Not built: shared fill or waitlist across parties, a changeable party count, more than two parties.

## Update 2026-11-11
Superseded in part by [ADR 0047](0047-cta-one-message-in-channel-bombers.md): a CTA is now one message for all parties, in the CTA channel. The party model, fill and waitlist per party and `maxPartiesFor` stay.
