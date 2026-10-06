---
title: Owner accepts the POC with several live checks still open
type: decision
status: accepted
date: 2026-10-06
tags: [phase-gate, poc]
satisfies: [CHK-002, CHK-003, CHK-004, CHK-005, CHK-007]
---

# 0007: Owner accepts the POC with several live checks still open

## Context
The owner created content live in their PvP forum and the roster was posted with working buttons. They then said the POC "seems acceptable". Recorded results exist for CHK-001 and CHK-006. CHK-002, CHK-003, CHK-004, CHK-005 and CHK-007 have no recorded passing result: the first roster post was seen working, but the time display, concurrent sign-up, cold-start timing and the scheduled vote result were not verified. The phase gate says MVP work does not start before every non-dropped check passes.

## Decision
The owner's acceptance moves the project to the MVP phase. The five checks stay open and are not marked passed. They are carried as risks into the MVP and run when each depends on MVP work or on owner setup (see consequences). Edit and cancel (FT-005), one content per post (FT-012) and the visual theme (FT-013) are MVP work. Rejected: marking the checks as passed without running them.

## Consequences
- The vote result is **not verified to post automatically**. It needs two owner steps: GitHub's default branch must contain `.github/workflows/cron.yml` (scheduled workflows run only from the default branch), and the repository secrets `CRON_URL` and `CRON_SECRET` must be set.
- The 3-second cold-start budget is unmeasured. The Vercel function region must be Dublin (`dub1`) to match Supabase eu-west-1 (open question Q13).
- Concurrent sign-up is covered by automated tests on a real Postgres but not by two live clicks.
- CHK-007 (a week without Supabase pausing) can only complete after 7 days of the scheduled job running.
- Anyone changing the reminder, vote or locking behavior should run CHK-004 and CHK-005 first.
