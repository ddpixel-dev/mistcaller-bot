---
title: Roadmap
type: plan
status: draft
date: 2026-10-06
---

# Roadmap

The goals and exit criteria live in [PRODUCT.md](../../PRODUCT.md) (Phases). This file orders the work.

| Phase | Goal | Exit | Milestones | Status |
|---|---|---|---|---|
| POC | Free hosting carries create, signup under concurrency, vote and scheduled jobs | all CHK checks pass and are recorded | M0, M1, M2, M3 | not started |
| MVP | The guild runs its daily content through the bot | MVP exit criteria in PRODUCT.md | M4, M5 | not started |
| Later | Public publishing, templates, recurring content, export | | | not planned |

## Order of work and why
1. M0 first: a deployed, signature-checked endpoint settles the riskiest hosting questions early.
2. M1 and M2 build the core loop, since everything else hangs off the roster.
3. M3 adds votes and the scheduled job, the last POC risk, so the owner can test the whole loop in the guild.
4. M4 and M5 complete the MVP after the POC gate.
