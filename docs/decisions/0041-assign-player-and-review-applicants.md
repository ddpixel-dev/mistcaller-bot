---
title: Assign player and Review applicants are separate panels
type: decision
status: accepted
date: 2026-11-08
tags: [manage, selection]
satisfies: [FR-065, FR-047, FR-058]
---

# 0041: Assign player and Review applicants are separate panels

## Context
In a host-selected event the one Manage button was **Review applicants** and it also held the member picker, so the host could not simply place any member without going through a panel about applicants (owner request 2026-11-08).

## Decision
- **Assign player** (renamed from Add player) is in every event: fills and a member picker, never the applicants.
- **Review applicants (n)** is added in host-selected events: only the applicants, no member picker. It is dimmed with nobody waiting. Declining stays **Remove player**.
- Custom ids: `fa:<id>` opens Assign player, `fa:r:<id>` opens Review applicants, `fa:p` (a fill) and `fa:q` (an applicant) choose a player, `fa:u` a member, `fa:s` a position. Older panels keep working.
- **Set weapon** moves to the end of the second button row, because the first row holds five buttons at most.

## Consequences
- Supersedes the Add player name of ADR 0029 and the shared panel of ADR 0035.
- The member picker can still pick an applicant; they are then accepted like anyone else.
