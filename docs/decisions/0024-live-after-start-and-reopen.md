---
title: Rosters stay live after the start; ended content can be reopened
type: decision
status: accepted
date: 2026-10-09
tags: [roster, lifecycle, signup]
satisfies: [FR-034, FR-035, FR-020, FR-009, FR-007, FR-015, FR-028]
supersedes: [FR-012]
---

# 0024: Rosters stay live after the start; ended content can be reopened

## Context
Owner request of 2026-10-09. At its start time a roster locked itself and could no longer be edited, and nobody could sign up, move, wait or be assigned. Content in Albion often runs on, with late joiners and changes. The owner wants every action to keep working until the content ends (`/content end` or the 4-hour rule), and wants to bring ended content back.

## Decision
- **No lock at the start (FR-034, supersedes FR-012).** The scheduled `lockStarted` step is removed. Whether content accepts actions depends on its status only: `open` allows edit, join, move, waitlist, waitlist promotion and Assign fill, before and after the start. `locked` is now only the manager's own `/content lock`, which works before and after the start, and `/content unlock` likewise.
- **Unchanged on purpose.** The loot vote still closes 5 minutes before the start (ADR 0005, FR-008): the result is posted at the cutoff. Edit still needs `open` (unlock first). Ending still needs the start to have passed.
- **`/content list` (FR-015)** shows content that is open or locked, started or not, until it ends.
- **Reopen (FR-035).** `/content reopen` (a command only, like `/content end`) turns `done` content back to `open` for the same managers, whether it was ended by hand or by the 4-hour rule. It clears `ended_at` and sets `reopened_at` (migration 0017).
- **Auto-end clock.** The 4-hour rule counts from `greatest(starts_at, reopened_at)`, so reopened content is not ended again within minutes.
- **Attendance.** The report and the owner's attendance DM are one-time actions and are not undone or resent by a reopen.
- **No conflict with a newer content.** The one-content-per-post index covers `done` content (FR-019), so nothing else can have taken the post.

## Consequences
- Migration 0017 (`content.reopened_at`). Commands changed (re-register): `reopen` added, descriptions of `unlock` and `list`.
- `RosterView.started` is removed; the banner "The roll is closed." now shows only for locked content.
- `runJobs` and the cron route no longer report a `locked` count.
- Old behavior is superseded, not deleted: FR-012 stays in `PRODUCT.md`, marked superseded.
