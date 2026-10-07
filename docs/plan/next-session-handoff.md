---
title: Next-session handoff
type: plan
status: active
date: 2026-10-07
---

# Next-session handoff

Read `PRODUCT.md` and [INDEX.md](../INDEX.md) first. Then this note.

## Where things stand
- The bot is **live**: `https://mistcaller-bot.vercel.app/api/discord`, Vercel production branch `poc/m0-m3`, Supabase eu-west-1. `/content create` works in the PvP forum. Repo: `ddpixel-dev/mistcaller-bot`. Local `bots/` is on branch `poc/m0-m3`; nothing was merged to `main`.
- The owner accepted the POC ([ADR 0007](../decisions/0007-poc-accepted-with-open-checks.md)). Phase is MVP.
- Tests: `docker compose run --rm node npm test` (190+ passing) and `... npm run typecheck`. Run everything through Docker; never install on the host ([ADR 0006](../decisions/0006-docker-tooling-minimal-dependencies.md)).

## Not verified yet (do these first)
1. **CHK-005, the scheduled vote result.** GitHub runs scheduled workflows only from the default branch, so `.github/workflows/cron.yml` must be on it, and the repo secrets `CRON_URL` (`https://mistcaller-bot.vercel.app/api/cron`) and `CRON_SECRET` must exist. Then run the workflow by hand and test a timed vote.
2. **CHK-004, cold start.** Read the Vercel log line `{"evt":"interaction",...,"ms":N}` after 30 minutes idle. N must be under 3000. Confirm the Vercel function region is `dub1`.
3. **CHK-003, CHK-002** live: sign up, move, leave, vote, and the displayed local time. **CHK-007** needs 7 days.
4. The **PvE forum** is not visible to the bot (403). Give the bot's role View Channel and Send Messages in Posts there.

## Owner decisions already made (2026-10-06 and 2026-10-07)
- Edit and cancel: creator, Manage Server, officer role. Editable: title, start, tier, notes, loot toggle, add and rename slots, remove only empty slots. Cancel needs confirmation (FR-020, FR-021).
- One active content per forum post; a new one only after a cancel, never after done (FR-019).
- Style: Medieval Banner, Lines layout, owner-made icon and banner ([ADR 0008](../decisions/0008-medieval-banner-roster-style.md), FR-022).
- Slot definition: typed lines, guided steps and saved presets; presets can be saved from the first two modes (FR-024, FR-025).
- Weapon list from `ao-bin-dumps` (proposed, [ADR 0009](../decisions/0009-weapon-data-from-ao-bin-dumps.md)).

## Open questions to settle first in the session
- Q18 content kinds, Q19 weapon icons and rights, Q20 preset permissions and limits ([open-questions.md](../open-questions.md)). The Roster Studio mock-up artifact is only a mock-up.

## Suggested order for M4
1. Verify the open checks above (small, and they gate everything else).
2. FR-019 one content per post (database rule plus a clear message), then FR-020/021 edit and cancel.
3. FR-022 Medieval Banner renderer, then FR-023 content kinds once Q18 is decided.
4. FR-024/025/026 slot builder and presets, once Q19 and Q20 are decided.

For each feature use the design-first flow: guardrail check, design, owner approval, written plan, then build with reviews. The previous build's controller ledger is `bots/.superpowers/sdd/2026-10-06-m0-m3-implementation/progress.md` (git-ignored).
