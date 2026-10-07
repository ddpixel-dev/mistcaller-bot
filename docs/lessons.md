---
title: Lessons learned
type: log
status: active
date: 2026-10-06
---

# Lessons learned

## 2026-10-07: Parse workflow YAML before pushing
- What happened: `cron.yml` had an unquoted `run:` value containing `Authorization: Bearer`. YAML read the colon as a second key, so GitHub showed the workflow by its path, failed every push run, and never scheduled it. The POC's vote-result check was blocked by it.
- What we learned: an Actions entry listed by path with failed push runs means the workflow file is invalid. Use a block scalar (`run: |`) for shell commands.
- Follow-up: parse the file with a YAML parser in Docker before pushing a workflow change. Fixed on 2026-10-07; the manual run is green.

Dated entries, newest first. Record what surprised us, what we would do differently, and any rule worth adding to `AGENTS.md`.

## 2026-10-06: A passing check needs a positive control
- What happened: the anon-key check printed "ok" while every request was a 404, because the configured URL contained a path. The check treated 404 as "denied".
- What we learned: a security check that accepts "not found" as success must first prove it is talking to the real service.
- Follow-up: `scripts/check-anon.ts` now normalizes the URL and runs a positive control; the whole-branch review also found that TypeScript 7 would break the Vercel build and that `schema_migrations` was open to the Data API.

## 2026-10-06: Free-tier terms are claims to verify
- What happened: planning relied on free-tier limits from third-party summaries, and the hosting choice changed after checking them.
- What we learned: treat limits as open questions with a POC check, not as facts.
- Follow-up: Q1 to Q6 in the open questions.
