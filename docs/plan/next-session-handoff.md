---
title: Next-session handoff
type: plan
status: active
date: 2026-10-07
---

# Next-session handoff

Read `PRODUCT.md` and [INDEX.md](../INDEX.md) first. Then this note.

## Where things stand
- Live at `https://mistcaller-bot.vercel.app/api/discord`, Vercel production branch `main`, functions pinned to `dub1`, Supabase eu-west-1. Repo `ddpixel-dev/mistcaller-bot`.
- Git flow (ADR 0014): `main` is releases (tagged), `develop` integrates, `feature/*` and `hotfix/*` branches. Releases so far: v0.2.0, v0.2.1, v0.3.0; 0.4.0 prepared.
- Tests: `docker compose run --rm node npm test` and `... npm run typecheck`. Everything runs through Docker.
- Release steps (the sandbox blocks pushes to `main` and production database access, so the owner runs them): migrate (`npm run migrate`), merge and tag and push `main`, wait for Vercel, `npm run register`.

## Open work
- FT-015 phases 2 and 3 (weapon data and search, guided steps): [design](2026-10-07-ft-015-slot-builder-design.md).
- FT-003 waitlist, FT-005 lock and creation cap, FT-007 reminders, FT-008 list, FT-009 attendance with the owner reminder.
- Owner: banner and icon art, PvE forum permission for the bot, live checks CHK-002 to CHK-005 and CHK-007.
- Open design point: the owner wants the signup menu to turn into a Leave control for the person who picked. Discord cannot show a control to some viewers only; see the answer in the session notes and ADR-worthy decision when settled.
