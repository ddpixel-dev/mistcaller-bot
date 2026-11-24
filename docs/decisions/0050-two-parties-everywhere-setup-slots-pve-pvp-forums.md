---
title: Two parties for every content, Setup Slots per party, PvE-or-PvP forums
type: decision
status: accepted
date: 2026-11-25
tags: [parties, card, guided, forums]
satisfies: [FR-081, FR-082, FR-083, FR-084]
---

# 0050: Two parties for every content, Setup Slots per party, PvE-or-PvP forums

## Context

On 2026-11-25 the owner asked for two parties on normal content, a rename of the Roles button, PvE-or-PvP forums, and a fix for Setup Slots filling party 1 only. Design: [docs/plan/2026-11-25-two-parties-setup-slots-forums-design.md](../plan/2026-11-25-two-parties-setup-slots-forums-design.md).

## Decision (agreed with the owner, 2026-11-25)

- **Two parties:** every normal content may have one or two parties. The host chooses on the card, and the content shows as one roster message, like a CTA. Bombers stay CTA-only. Supersedes in part FR-070, ADR 0044 and ADR 0047, which limited parties to CTAs.
- **Rename:** the Roles button is **Setup Slots**.
- **Forums:** PvE content goes to the PvE forum. PvP, PvX and ZvZ content goes to the PvP forum. CTAs keep their channel. `forum-type` offers PvP and PvE only. Supersedes in part ADR 0037.
- **Setup Slots per party:** on a two-party card, Setup Slots first asks which party. The builder fills that party only. Option A of three; B (one pass for both) and C (a switch inside the builder) were not chosen.

## Consequences

- Migration 0037 adds `slot_draft.guided_party`.
- The commands are registered again.
- Old PvX and ZvZ forum settings stay in the database, unused.
