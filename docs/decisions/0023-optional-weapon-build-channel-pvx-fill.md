---
title: Optional weapon, build channel, PvX and Fill
type: decision
status: accepted
date: 2026-10-08
tags: [roster, signup, creation]
satisfies: [FR-003, FR-005, FR-023, FR-030, FR-031, FR-032, FR-033]
---

# 0023: Optional weapon, build channel, PvX and Fill

## Context
Owner requests of 2026-10-08. The design is in `docs/plan/2026-10-08-optional-weapon-build-channel-pvx-fill.md`; the owner approved it the same day and asked for one release.

## Decision
- **Optional weapon (FR-030).** A slot may be a role alone (`slot.weapon` is null; in code an empty string). It shows as "Player's choice". After joining such a slot the player gets a private weapon picker (class, then weapon), saved in `signup.chosen_weapon` and shown on the roster; the choice stays between role-only slots and is cleared otherwise. `/content me` can change it.
- **Build channel (FR-031).** `content.build_channel_id`, set by the optional `build-channel` option of `/content create` and `/content edit` (`clear-build` removes it), checked against the channels Discord resolved (text, announcement, forum, thread). A header line shows it as a mention.
- **PvX (FR-033).** A third type with every PvP and PvE category (Other once, last).
- **Fill (FR-032).** `signup.status = 'fill'`: signed up without a position. Chosen in the join menu (and in the waitlist menu when full). The creator and admins place a fill in an open position with the **Assign fill** button or `/content assign`; nobody is swapped out and fills are never seated automatically. A fill counts as signed up for leaving, voting, Ping, the reminder, attendance, history and the edit and cancel notices.

## Consequences
- Migration 0016. Commands changed (re-register): `create` and `edit` options, `assign`, optional `slot` weapon.
- Every query on `signup.status = 'signed'` was audited; the ones about people now include `fill`, the ones about filled positions do not.
- The create panel's ids carry the build channel (worst case 90 of 100 characters, tested).
- The `Build` header label's padding was estimated, not measured; calibrate it from a screenshot (Q22).
