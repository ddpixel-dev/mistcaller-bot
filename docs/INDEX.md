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
- [0006 Docker tooling](decisions/0006-docker-tooling-minimal-dependencies.md): no host installs, minimal dependencies
- [0007 POC accepted](decisions/0007-poc-accepted-with-open-checks.md): owner accepts the POC with live checks still open
- [0008 Medieval Banner style](decisions/0008-medieval-banner-roster-style.md): theme, Lines layout, owner-made art
- [0009 Weapon data from ao-bin-dumps](decisions/0009-weapon-data-from-ao-bin-dumps.md): accepted, no license on the data
- [0010 Content kinds](decisions/0010-content-kinds-fixed-list.md): fixed list in code
- [0011 Weapon icons as emoji](decisions/0011-weapon-icons-as-application-emoji.md): superseded by 0013
- [0013 Weapon icons by link](decisions/0013-weapon-icons-by-link.md): linked from the render service, not uploaded
- [0014 Git flow](decisions/0014-git-flow.md): main, develop, feature, release, hotfix branches
- [0012 Preset permissions](decisions/0012-preset-permissions-and-cap.md): Manage Server and officer role, 25 per server

## Architecture
- [Overview](architecture/overview.md)

## Plan
- [Roadmap](plan/roadmap.md)
- [Milestones](plan/milestones.md)
- [Tasks](plan/tasks.md)
- [Next-session handoff](plan/next-session-handoff.md)
- [M0 to M3 implementation plan](plan/2026-10-06-m0-m3-implementation.md)
- [FT-015 slot builder and presets design](plan/2026-10-07-ft-015-slot-builder-design.md)

## Working notes
- [Open questions](open-questions.md)
- [Lessons](lessons.md)

## Process
- [Guardrails and audit](process/guardrails.md)
- [Recording rules](process/recording.md)
