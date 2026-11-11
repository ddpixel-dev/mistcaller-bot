---
title: A CTA is one message in the CTA channel, with optional Bombers
type: decision
status: accepted
date: 2026-11-11
tags: [roster, cta, parties, bombers]
satisfies: [FR-070, FR-071, FR-072, FR-073]
supersedes: [0044 (in part)]
---

# 0047: A CTA is one message in the CTA channel, with optional Bombers

## Context
After testing 0.31.8 the owner asked (2026-11-11) for the whole CTA in one message, as another server does with two parties of up to 40 players, and for that message to be the one in the CTA channel so players sign up without opening the thread. They also asked for a Bombers list, CTA presets, separate Details and slots buttons, and no "pinned a message" notices. Design: [the design](../plan/2026-11-11-cta-one-message-bombers-design.md).

## Decision
- A new CTA's roster is posted in the CTA channel and the thread is started from it (`content.roster_channel_id`). It holds every party, one open-positions menu per party, and the shared buttons. It is not pinned.
- A player holds one place per CTA: a seat, a waitlist spot, a fill, an application, or Bombers. Leave and Tentative are shared.
- Bombers: an optional list with no positions, a cap of 1 to 20 set in Details, joined with a 💣 Bombers button (signup status `bomber`).
- Content found from a click uses the content id in the custom id, checked against the verified guild and the content's thread or roster channel.
- Presets carry `cta`: each card lists only its own kind.
- After a pin the bot deletes Discord's pin notice when it can (Manage Messages).

## Consequences
- Supersedes ADR 0044 in part: one message per party is replaced; the party model, per-party fill and waitlist, and `maxPartiesFor` stay.
- 0.31.8 CTAs are converted on their next refresh (party 2's message becomes a short note).
- Migration 0033; production is migrated before the deploy.
