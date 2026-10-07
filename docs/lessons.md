---
title: Lessons learned
type: log
status: active
date: 2026-10-06
---

# Lessons learned

Dated entries, newest first. Record what surprised us, what we would do differently, and any rule worth adding to `AGENTS.md`.

## 2026-10-07: A button emoji must be a real emoji, and logs must carry Discord's reason
- What happened: after release 0.8.0, creating a roster with a Healer slot failed with "Could not create the content". The log showed only `create_failed` and `DiscordApiError`. The Healer icon was "✚", a dingbat that looks like an emoji but is not one, and Discord rejects a button carrying it, so the whole roster message was refused.
- What we learned: text can use any symbol, but a component's `emoji` must be a real emoji. Also, logging only an error's class name hid the cause. Discord's own error code and message are safe to log (they never contain the token).
- Follow-up: Healer uses 💚; a test checks every button icon is a real emoji; `DiscordApiError` keeps Discord's code and message and `create_failed` logs status, code and reason.

## 2026-10-07: Pin the function region next to the database
- What happened: after release 0.2.0, button and menu clicks took 1.9 to 4.0 s and Discord showed "didn't respond in time" (the private Leave reply, the cancel confirmation). The logs showed the functions ran in `iad1` (US east) while Supabase is in eu-west-1, and a signup makes about a dozen queries.
- What we learned: Vercel's default region is not near the database. Q13 had flagged this but was left as a dashboard step that never happened.
- Follow-up: `vercel.json` now pins `dub1`, with a test that guards it. Signup and Leave also make fewer round trips. Read the `"ms"` log line after each release and keep it under 3000.

## 2026-10-07: Parse workflow YAML before pushing
- What happened: `cron.yml` had an unquoted `run:` value containing `Authorization: Bearer`. YAML read the colon as a second key, so GitHub showed the workflow by its path, failed every push run, and never scheduled it. The POC's vote-result check was blocked by it.
- What we learned: an Actions entry listed by path with failed push runs means the workflow file is invalid. Use a block scalar (`run: |`) for shell commands.
- Follow-up: parse the file with a YAML parser in Docker before pushing a workflow change. Fixed on 2026-10-07; the manual run is green.

## 2026-10-06: A passing check needs a positive control
- What happened: the anon-key check printed "ok" while every request was a 404, because the configured URL contained a path. The check treated 404 as "denied".
- What we learned: a security check that accepts "not found" as success must first prove it is talking to the real service.
- Follow-up: `scripts/check-anon.ts` now normalizes the URL and runs a positive control; the whole-branch review also found that TypeScript 7 would break the Vercel build and that `schema_migrations` was open to the Data API.

## 2026-10-06: Free-tier terms are claims to verify
- What happened: planning relied on free-tier limits from third-party summaries, and the hosting choice changed after checking them.
- What we learned: treat limits as open questions with a POC check, not as facts.
- Follow-up: Q1 to Q6 in the open questions.
