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
- Git flow (ADR 0014): `main` is releases (tagged), `develop` integrates, `feature/*` and `hotfix/*` branches. Released up to **v0.15.1** (migrations through 0014). `mvp-approved` tag = the owner-approved MVP build (0.10.0). `develop` equals that release plus docs.
- Tests: `docker compose run --rm node npm test` and `... npm run typecheck`. Everything runs through Docker.
- Release steps (the owner has asked the agent to run them): `npm run migrate`, merge to `main`, tag, push, merge back into `develop`, wait for Vercel (poll the commit status on GitHub), `npm run register` when commands changed.
- Since 0.14.0 (ADR 0020, ADR 0019): commands are registered globally (no server id), content can be created in any channel, thread or forum post, `/content setup` is a role picker for the admin roles, the Ping players button works once per content, header and rows are padded for alignment, and cron-job.org drives `/api/cron` (automatic reminders stay off until verified).
- Since 0.15.0 (ADR 0021): roster rows are grouped under a heading per role, the header columns use measured en-space counts, and Ping players also sends the owner a copy. The owner turned on `AUTO_REMINDERS` in Vercel on 2026-10-08; verify the reminder arrives.
- The roster is a Components V2 message since 0.10.0 (ADR 0018): open-positions menu, one shared Leave button, weapon emoji. Rosters posted before 0.10.0 are read-only (their controls explain this).

## In progress: the roster rewrite (owner-approved on 2026-10-07)
Approved design, in the owner's words and my confirmation:
1. **Join: Option E**, one menu that lists **only the open positions** (a taken one disappears), with the weapon icon as each option's emoji.
2. **Leave per player**: the roster becomes a Discord **Components V2** message (flag `1 << 15`; no embeds or content; a message holds at most **40 components**; a Section holds up to 3 text blocks and one button accessory; the flag is permanent per message, so old rosters keep the old layout and their buttons keep working). Each sworn row is a Section with its own **Leave** button, which only that player may use (others get a private refusal). Components: Container 1 + header text 1 + sworn row 3 + open row 1 + menu 2 + vote row 3. Fits up to **11 positions**. From **12 positions** the rows are one text block and Leave is one shared button (dimmed while nobody is signed up). `/content me` stays.
3. **Row format**: `roleIcon Role - <weaponEmoji> Weapon - <dutyIcon Duty if any> · Sworn: @Player` (open rows end with `Open`).
4. **Header lines** (separate, with icons): `⚔️ type · category`, `🛡️ Tier: ...`, `💰 Loot vote: On · Split 3 · Regear 2 · closes <time>` and, after the cutoff, `💰 Loot vote: On · Result: Split won 3-2` on the **same line**; then UTC and Your time.
5. **Weapon icons**: uploaded as application emoji. Code: `src/domain/weaponEmoji.ts`, `src/render/weaponIcon.ts`, `scripts/sync-emoji.ts`, `src/data/weapon-emoji.ts` (generated). Run: `docker compose run --rm node node scripts/sync-emoji.ts` (needs `DISCORD_APP_ID` and `DISCORD_BOT_TOKEN` from `.env`). Black Hands has no icon at the render service and shows its name only.
6. **First step before the rewrite: a Discord limits checker in the tests** (components at most 40 in V2, at most 5 rows and 5 buttons per row in classic messages, 25 menu options, label and id lengths, text at most 4000, valid emoji). The Healer "✚" emoji bug got through because tests did not check Discord's rules.
7. Handlers to adapt: they update the roster by returning the new payload (include the V2 flag in edits and in `UPDATE_MESSAGE` data). On an old (non-V2) roster message, refuse politely, because the flag cannot be added. The cron job posts the vote result text; reword to `Loot vote result: ...`.

## Open work after the rewrite
- FT-003 waitlist (buttons become "Join the waitlist" when full), FT-005 lock and creation cap, FT-007 reminders, FT-008 `/content list`, FT-009 attendance with the owner reminder, FR-017 roster recovery.
- Owner: banner and icon art (`src/render/theme.ts`), PvE forum permission, live checks CHK-002 to CHK-005 and CHK-007.
- Lesson recorded: GitHub once answered pushes with "Internal Server Error"; it cleared by itself. Not yet in `docs/lessons.md`.
