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
- Git flow (ADR 0014): `main` is releases (tagged), `develop` integrates, `feature/*` and `hotfix/*` branches. Released: v0.2.0, v0.2.1, v0.3.0, v0.4.0, v0.5.0. Release 0.6.0 is prepared (needs migration 0005).
- Tests: `docker compose run --rm node npm test` and `... npm run typecheck`. Everything runs through Docker.
- Release steps (the sandbox blocks pushes to `main` and production database access, so the owner runs them): `npm run migrate`, merge and tag and push `main`, merge back into `develop`, wait for Vercel, `npm run register`. If GitHub answers a push with "Internal Server Error", it is on their side: retry later (lesson not yet recorded).

## Built in this stretch
- One content per post, edit and cancel, `/content setup`, kinds (fixed list), presets, `/content weapon`, guided slot steps, `/content me` (private panel with your own Leave button), a shared Leave button (dimmed while nobody is signed up), a create panel (kind, loot vote, preset, guided slots).

## Open work
- FT-003 waitlist, FT-005 lock and creation cap, FT-007 reminders, FT-008 `/content list`, FT-009 attendance with the owner reminder, FR-017 roster recovery.
- Owner: banner and icon art (set URLs in `src/render/theme.ts`), PvE forum permission for the bot, live checks CHK-002 to CHK-005 and CHK-007, asking Sandbox about the render service.
- Guided steps defaults to confirm: fixed role list, "Same as previous / Fill the rest / Back", icon as card thumbnail.
