---
title: Next-session handoff
type: plan
status: active
date: 2026-11-06
---

# Next-session handoff

Read `PRODUCT.md` (its Current state) and [INDEX.md](../INDEX.md) first. Then this note. History of earlier handoffs is in git.

## Where things stand (2026-11-11)
- **Released before: v0.32.0** on `main`, migrations through **0036** (slots by role or by weapon FR-076, strict roles and weapons FR-077, ADR 0049): migration **0036** must run on production before the deploy; changelog `changelog/0.32.0.md`; commands unchanged.
- **Start of the next session (owner request 2026-11-25): set up a TypeScript language server (LSP) first and use it.** ADR 0006 applies: run it in Docker or ask the owner before installing anything on the host; record the setup in `AGENTS.md`.
- **Released: v0.33.0** (two parties on every content, Setup Slots per party, PvE forum else PvP forum; FR-081 to FR-084, ADR 0050) on `main`, migrations through **0037**, commands registered again (`forum-type` is PvP or PvE).
- **Released before: v0.32.1** (hotfix): Edit details and Fix and retry use a multi-line notes box; Discord refused the form when one-line notes held a line break (lessons 2026-11-24). Still open from the 2026-11-24 logs: creations failing with 404 Unknown Channel, missing Pin Messages (403 50013), cron edits on archived threads (400 50083).
- **Released before: v0.31.12** (the calendar's 🔜 Upcoming label after Live now, FR-080); no migration, commands unchanged.
- **Released before: v0.31.11** (applicant fix FR-079, Edit preset FR-078, the 2026-11-22 batch FR-080, ADR 0049) on `main`, migrations through **0035**; commands unchanged. **Next: release C**, slots by Role or Weapon and strict roles and weapons (FR-076, FR-077): design [2026-11-22-slot-modes-and-batch-design.md](2026-11-22-slot-modes-and-batch-design.md) section "Release C", plan still to write, migration 0036. The owner asked to wait for the go-ahead before starting it.
- **Released before: v0.31.10** (ZvZ type, Massing at, FR-074 and FR-075, ADR 0048) on `main`, migrations through **0034**; commands registered again. Before it v0.31.9 (migrations through 0033). `develop` equals it. A CTA is one message in the CTA channel with Bombers, CTA presets and quiet pins (FR-070 changed, FR-071 to FR-073, ADR 0047, plan [2026-11-11-cta-one-message-implementation.md](2026-11-11-cta-one-message-implementation.md)). Rollback note: 0.31.8 on migration 0033 cannot render a one-message CTA (its roster is in the CTA channel); redeploy 0.31.9 instead. Live checks the owner still does: the bot needs Manage Messages (pin notices); click `channel.id` for the message in the CTA channel; two-party create time in `publish_ms`. Parked: rows are cut silently from party 2's tail only if fills, waitlist and bombers are all huge; weapon icons are dropped for a full 40-row CTA; dead `party > 1` code in `renderPartyMessage`. Earlier: v0.31.8 shipped FR-070 two parties (ADR 0044). Rollback note: redeploying 0.31.7 after two-party content exists renders all slots on party 1's message and leaves party 2's message stale; migration 0032 is additive, so 0.31.7 still runs on it.
- Parked follow-ups (from the final review): a duplicate of an existing legacy CTA line passes the role check; three rare replies (held-slot error, duty no_slot, fill unchanged) show content-wide positions on two-party content; a deleted roster message is not reposted (open question Q25); measure the two-party CTA create time from the `publish_ms` log.
- Earlier note (2026-11-10): v0.31.7 shipped FR-069 (forwarded CTA message).
- **Done: release 0.31.8, two parties in a CTA (FR-070).** Plan: [2026-11-10-cta-parties-implementation.md](2026-11-10-cta-parties-implementation.md), 13 tasks on `feature/cta-parties`, migration 0032, run subagent-driven. Design: [2026-11-10-cta-pinned-message-and-parties-design.md](2026-11-10-cta-pinned-message-and-parties-design.md) Part 2 (positions stay unique per content, party 1 first; the displayed number restarts per party). `/content help` is at its 2000-character limit; Task 13 must make room.
- Earlier note (2026-11-06): v0.31.1 was released with migrations through 0027. Live at `https://mistcaller-bot.vercel.app/api/discord`, Vercel production branch `main`, functions in `dub1`, Supabase eu-west-1, repo `ddpixel-dev/mistcaller-bot`. Everything runs in Docker (`docker compose run --rm node ...`); never install tools on the host.
- Git flow (ADR 0014): `main` is releases (tagged), `develop` integrates, `feature/*`, `release/*` and `hotfix/*` branches. Merge with `--no-ff`. Commits end with the attribution line from the session reminder.
- Tests: `docker compose run --rm node npm test` (662 tests, all green) and `docker compose run --rm node npx tsc --noEmit`. Database tests use the local `db` container (`TEST_DATABASE_URL`), never production.
- The 0.29.0 to 0.31.1 plan and what each release contains: [2026-11-06-releases-0.29-0.32.md](2026-11-06-releases-0.29-0.32.md). Decisions: ADR 0035 (fill preferences, selection mode) and ADR 0036 (creation hub, blank content, CTA).

## Next: release 0.32.0, ZvZ
**Start with [2026-11-06-zvz-brief.md](2026-11-06-zvz-brief.md).** Nothing is designed; the owner wants to brainstorm it together. It includes the owner's words, the limits to design around, the questions to settle, and the release checklist.

## Open items
- **Owner, after 0.31.0:** run `/content setup`, set `cta-channel` (a text channel) and the CTA roles; give the bot Create Public Threads, Send Messages in Threads, Manage Threads and Pin Messages in that channel, and Pin Messages in the event forums. Until then Special content answers that no CTA channel is set.
- **Question to the owner, unanswered:** the owner said the waitlist selection "was removed". It is hidden by design in selection events and shown only for roles that are completely full in normal events. Ask which roster it was (selection or normal, which role was full) before treating it as a bug.
- Another server has a calendar but no changelog channel (`/content setup changelog-channel`), so it gets no announcements. The server `930416724078104586` has a stale calendar (last updated 2026-10-15).
- **Dead code to clean up:** `handleCreateCommand`, `handleCreateModal`, `postTitle`, `placeProblem` and their tests in `tests/handlers/create.test.ts`, `build-pvx.test.ts` and `preset.test.ts` are unused since `/content create` was removed (0.31.0). `new-requirements.md` is the owner's untracked file.
- The CTA announcement in the CTA channel is not updated when the host edits the title or start; the thread is renamed. Known limitation (ADR 0036).
- Older open items are in [open-questions.md](../open-questions.md): Q21 (database cleanup later), Q22 (calibrate the Build header padding); and the live checks CHK-002 to CHK-007.

## Things that cost time before (read once)
- Discord rejects the whole command list (status 400) for one description over 100 characters; `tests/discord/commands-limits.test.ts` checks it now.
- A release command that runs in the background can finish before a message that arrives mid-run takes effect. Stop and check `git ls-remote --tags origin` before assuming nothing was pushed.
- Do not write temporary files outside the repo's normal places; probe behaviour with a test instead of a scratch script.
- `scripts/post-changelog.ts` posts to the changelog channel (a text channel, or a forum as one post per release) and records the version so it never posts twice; always `--dry-run` first.
