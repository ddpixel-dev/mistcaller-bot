---
title: Content Roster Bot documentation index
type: index
status: accepted
date: 2026-10-06
---

# Index

Start with [PRODUCT.md](../PRODUCT.md): the product, requirements, phases, and current state.

Every document under `docs/` must be linked here. Add new ones in the same turn you create them; when one is superseded, keep its link and mark it.

## Decisions
- [0001 Hosting and stack](decisions/0001-hosting-and-stack.md): Vercel and Supabase, HTTP-only TypeScript bot
- [0002 Scheduled jobs](decisions/0002-scheduled-jobs-github-actions.md): GitHub Actions every 5 minutes
- [0003 Permissions](decisions/0003-permissions-and-creation-cap.md): anyone creates; creator, admin, officer manage; cap of 5 per day
- [0004 Slot model](decisions/0004-slot-model.md): one line per slot, maximum 20
- [0005 Vote cutoff](decisions/0005-vote-cutoff.md): closes 5 minutes before the start

## Architecture
- [Overview](architecture/overview.md)

## Plan
- [Roadmap](plan/roadmap.md)
- [Milestones](plan/milestones.md)
- [Tasks](plan/tasks.md)

## Working notes
- [Open questions](open-questions.md)
- [Lessons](lessons.md)

## Process
- [Guardrails and audit](process/guardrails.md)
- [Recording rules](process/recording.md)
