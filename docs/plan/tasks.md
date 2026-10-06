---
title: Tasks
type: plan
status: draft
date: 2026-10-06
---

# Tasks

The detailed step-by-step plan for M0 to M3 is [2026-10-06-m0-m3-implementation.md](2026-10-06-m0-m3-implementation.md). Its Tasks 1 to 14 refine T2 to T9 and T14 below; the table here stays the high-level tracker.

| ID | Task | Milestone | Satisfies | Status |
|---|---|---|---|---|
| T1 | Create the Discord application and the Supabase project (owner) | M0 | CHK-001 | in progress (owner accounts created) |
| T2 | Scaffold the TypeScript project and the signed endpoint | M0 | CHK-001, NFR-001 | code done, live check pending |
| T3 | Migrations with row-level security; test the anon key | M0 | CHK-006, NFR-004 | code done, live check pending |
| T4 | Deploy to Vercel, set the endpoint URL, measure a cold start | M0 | CHK-004 | code done, live check pending |
| T5 | Domain parsers (tier, slots, UTC) with unit tests | M1 | FR-003, NFR-007 | code done, live check pending |
| T6 | `/content create` and the roster renderer | M1 | FT-001 | code done, live check pending |
| T7 | Signup menu, move, leave, atomic claim | M2 | FT-002 | code done, live check pending |
| T8 | Vote buttons and cutoff rule | M3 | FR-008 | code done, live check pending |
| T9 | `/api/cron` and the GitHub Actions workflow | M3 | FR-013, CHK-005 | code done, live check pending |
| T10 | Edit, lock, cancel, permissions, creation cap, waitlist | M4 | FT-003, FT-005 | not started |
| T11 | `/content setup`; roster recovery when the message is deleted | M4 | FR-016, FR-017 | not started |
| T12 | Reminders and `/content list` | M5 | FT-007, FR-015 | not started |
| T13 | Attendance marking and history | M5 | FR-014 | not started |
| T14 | Safe text and restricted mentions across all messages | M1 | FR-018 | code done (escapeText, allowed_mentions) |

FT-011 (templates, recurring content, export) is deferred and has no task on purpose.
