---
title: An external cron service calls the cron route; automatic reminders stay off until verified
type: decision
status: accepted
date: 2026-10-08
tags: [scheduler, reminders]
satisfies: [FR-011, FR-013]
---

# 0019: External cron service for scheduled jobs

## Context
Q1 measured GitHub's 5-minute schedule running only about every 4 to 6 hours (runs at 20:24, 00:16 and 06:12 UTC). Reminders, lock-at-start, the vote result and the attendance DM all fired hours late. The cron route (`/api/cron`) accepts GET and POST with `Authorization: Bearer CRON_SECRET`, so any caller can drive it.

## Decision
- Owner decision 2026-10-08 (option B): a free external cron service (for example cron-job.org) calls `/api/cron` every few minutes. The GitHub workflow stays as a slow fallback; every job is claimed in the database before it acts, so two callers never act twice (NFR-005).
- The owner sets the service up (it needs the secret, which stays out of the repo). Exact values: URL `https://mistcaller-bot.vercel.app/api/cron`, method GET or POST, header `Authorization: Bearer <CRON_SECRET>`, every 1 to 5 minutes, treat any 2xx as success.
- The automatic 30-minute reminder stays off (`AUTO_REMINDERS` unset) until the owner has watched the service fire on time. The owner-only **Ping players** button, usable once per content, is the reminder meanwhile (FR-011).

## Consequences
- Adds a third-party service outside our adapters, called only as a caller, never fed data. Free tier only (NFR-003); no dependency is added to the repo.
- Q1 stays open until the first on-time lock and vote result are recorded.
