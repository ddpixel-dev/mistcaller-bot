---
title: Run scheduled jobs from GitHub Actions every 5 minutes
type: decision
status: accepted
date: 2026-10-06
tags: [scheduling]
satisfies: [FR-011, FR-012, FR-013]
---

# 0002: Run scheduled jobs from GitHub Actions every 5 minutes

## Context
Vercel Hobby cron runs once a day, so reminders, auto-lock and vote results need another trigger. Options: (A) a GitHub Actions schedule, (B) Supabase `pg_cron` every minute calling a Vercel route through `pg_net`, (C) move the vote cutoff earlier.

## Decision
Use option A for now, as the owner chose, and measure it in CHK-005. The workflow calls the protected `/api/cron` route with a secret header every 5 minutes. The repository is public and holds no secrets. Option B stays the documented alternative if A proves too imprecise.

## Consequences
- GitHub's minimum interval is 5 minutes and runs can be delayed or skipped, so the vote result may appear a few minutes after the cutoff and possibly after the start time. The cutoff itself stays exact because the click handler enforces it (see 0005).
- Reminders may fire at roughly 25 to 35 minutes before the start.
- Scheduled workflows in public repos can be disabled after a period without activity. To be verified.
- Each call queries the database, which also keeps Supabase from pausing.
