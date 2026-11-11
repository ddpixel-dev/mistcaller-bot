---
title: Content Roster Bot documentation index
type: index
status: accepted
date: 2026-10-06
---

# Index

Start with [PRODUCT.md](../PRODUCT.md): the product, requirements, phases, and current state.

Every document under `docs/` must be linked here. Add new ones in the same turn you create them; when one is superseded, keep its link and mark it.

## Decisions
- [0001 Hosting and stack](decisions/0001-hosting-and-stack.md): Vercel and Supabase, HTTP-only TypeScript bot
- [0002 Scheduled jobs](decisions/0002-scheduled-jobs-github-actions.md): GitHub Actions every 5 minutes
- [0003 Permissions](decisions/0003-permissions-and-creation-cap.md): anyone creates; creator, admin, officer manage; cap of 5 per day
- [0004 Slot model](decisions/0004-slot-model.md): one line per slot, maximum 20
- [0005 Vote cutoff](decisions/0005-vote-cutoff.md): closes 5 minutes before the start
- [0006 Docker tooling](decisions/0006-docker-tooling-minimal-dependencies.md): no host installs, minimal dependencies
- [0007 POC accepted](decisions/0007-poc-accepted-with-open-checks.md): owner accepts the POC with live checks still open
- [0008 Medieval Banner style](decisions/0008-medieval-banner-roster-style.md): theme, Lines layout, owner-made art
- [0009 Weapon data from ao-bin-dumps](decisions/0009-weapon-data-from-ao-bin-dumps.md): accepted, no license on the data
- [0010 Content kinds](decisions/0010-content-kinds-fixed-list.md): fixed list in code
- [0011 Weapon icons as emoji](decisions/0011-weapon-icons-as-application-emoji.md): superseded by 0013
- [0013 Weapon icons by link](decisions/0013-weapon-icons-by-link.md): linked from the render service, not uploaded
- [0018 Roster as Components V2](decisions/0018-roster-as-components-v2.md): open-positions menu, one shared Leave button
- [0019 External cron service](decisions/0019-external-cron-service.md): reminders and jobs on time; automatic reminder stays off until verified
- [0027 Stats command instead of a channel](decisions/0027-stats-command-instead-of-channel.md): `/content stats`, private; the statistics channel is removed
- [0028 Compact roster, Manage panel and host sign-up](decisions/0028-compact-roster-manage-panel-host-signup.md): numbered rows, `##` title, no loot line or spacers; Manage panel; Sign up player; no Fill on the waitlist; Catcher duty
- [0029 Manage replaces the host commands](decisions/0029-manage-replaces-host-commands.md): nine host commands removed; Edit panel; Set weapon; Manage on finished rosters; Add player; title from the post; no party strip
- [0030 Positions by role, DTank, title icons](decisions/0030-role-order-dtank-title-icons.md): positions numbered Tank, DTank, Healer, Support, DPS (migration 0021); DTank 🧱; one category icon in the title; Scout 🔭
- [0031 The first create form](decisions/0031-first-create-form.md): one form (type and category, players, preset, gear tier, loot), then slot cards, then the final form; `weapon` and `slot` removed; 🏷️ Type line
- [0032 Creation card and bot-made forum posts](decisions/0032-creation-card-and-forum-posts.md): one creation card with reacting menus; launcher posts in event forums; the bot creates each event's post
- [0033 Start menus, Roles, locked launcher](decisions/0033-card-start-menus-locked-launcher.md): start as Day/Hour/Minute menus on a V2 card; Roles button; launcher "click here", locked, guidelines line
- [0034 Tips under the buttons, dimmed Create](decisions/0034-card-tips-dimmed-create.md): start back in Details; 💡 tips after the buttons; Create dimmed until valid; 👢 Remove player
- [0035 Fill preferences, selection mode](decisions/0035-fill-preferences-and-selection-mode.md): fill seated at once or waiting, no reserved seats; host-picked content
- [0036 Creation hub, blank content](decisions/0036-creation-hub-and-blank-content.md): buttons in content-management, CTA by role, blank type
- [0037 Forum per type, CTA role options](decisions/0037-forum-per-type-and-cta-role-option.md): no Any forum type, PvX has its own, `cta-role` option
- [0038 Changelog thread, preset menu, button names](decisions/0038-changelog-thread-preset-menu-button-names.md): thread target, always-on Preset menu, Plan Content and Schedule CTA
- [0039 Presets from the card](decisions/0039-presets-saved-from-the-card.md): Save as preset button (admins), whole-card presets, `/content preset` removed
- [0040 Host name as a mention](decisions/0040-host-name-as-mention.md): `👑 Host` on the roster and the calendar, no stored name, no migration
- [0041 Assign player and Review applicants](decisions/0041-assign-player-and-review-applicants.md): two panels, Assign for any member and fills, Review for applicants only
- [0042 Tentative sign-up](decisions/0042-tentative-signup.md): a flag on the sign-up row, a shared ❓ Tentative button, migration 0030
- [0043 Post name with date and time](decisions/0043-post-name-with-date-and-time.md): `Title | 12 Nov | 20:00 UTC`, renamed with the title and the start
- [0044 Two parties for a CTA](decisions/0044-cta-two-parties-one-message-each.md): superseded in part by 0047; one roster message per party, fill and waitlist per party, supersedes 0004 in part
- [0045 Pinned CTA message](decisions/0045-cta-pinned-message-copied-at-creation.md): accepted; copied at creation from a message link, pinned below the roster
- [0046 Message Content intent](decisions/0046-message-content-intent-on.md): accepted; needed to forward a member's message (FR-069), changes NFR-001
- [0047 One CTA message, Bombers](decisions/0047-cta-one-message-in-channel-bombers.md): accepted; the roster is the message in the CTA channel, all parties in it, optional Bombers, CTA presets, quiet pins
- [CTA in one message, Bombers design](plan/2026-11-11-cta-one-message-bombers-design.md): accepted 2026-11-11 (FR-070 to FR-073), release 0.31.9
- [CTA in one message implementation plan](plan/2026-11-11-cta-one-message-implementation.md): tasks on `feature/cta-one-message`, migration 0033
- [CTA pinned message and two parties design](plan/2026-11-10-cta-pinned-message-and-parties-design.md): accepted 2026-11-10 (FR-069, FR-070)
- [CTA pinned message implementation plan](plan/2026-11-10-cta-message-implementation.md): six tasks on `feature/cta-message`, migration 0031, built in 0.31.7 (FR-069)
- [CTA two parties implementation plan](plan/2026-11-10-cta-parties-implementation.md): thirteen tasks on `feature/cta-parties`, migration 0032, built in 0.31.8 (FR-070)
- [0026 Fill seats, dashboards, permission levels](decisions/0026-fill-seats-dashboards-permission-levels.md): the 0.21.0 decisions
- [Tentative sign-up design](plan/2026-11-08-tentative-signup-design.md): ❓ toggle button, flag on the sign-up row, migration 0030 (FR-067, accepted)
- [Release 0.32.0 brief: ZvZ](plan/2026-11-06-zvz-brief.md): the owner's request, limits, open questions and the release checklist, for a new session
- [Releases 0.29.0 to 0.32.0](plan/2026-11-06-releases-0.29-0.32.md): eleven owner requests, order and branches (FR-055 to FR-062)
- [Creation card and bot-made forum posts](plan/2026-10-24-creation-card-and-forum-posts-design.md): design and plan (FR-053, FR-054)
- [Release 0.21.0 plan](plan/2026-10-15-release-0.21.md): eleven owner requests, order and branches
- [0025 Form retry; build reference](decisions/0025-form-retry-and-build-reference.md): Fix and retry button, one build-reference link option
- [0024 Live after the start; reopen](decisions/0024-live-after-start-and-reopen.md): no auto-lock at the start, `/content reopen`, fresh auto-end window
- [0023 Optional weapon, build channel, PvX and Fill](decisions/0023-optional-weapon-build-channel-pvx-fill.md): roster and signup changes
- [0022 Server-only commands](decisions/0022-server-only-commands.md): works in any server it is added to
- [0021 Roster rows grouped by role](decisions/0021-roster-rows-grouped-by-role.md): layout E, measured header columns
- [0020 Setup without forums; admin roles](decisions/0020-setup-without-forums-admin-roles.md): any channel, global commands, role picker
- [0017 Weapon icons as application emoji](decisions/0017-weapon-icons-as-application-emoji-accepted.md): accepted, supersedes 0013 for the roster
- [0016 Type chosen in the create panel](decisions/0016-type-chosen-in-create-panel.md): type is a choice, kinds are called categories
- [0015 Weapon data as a generated file](decisions/0015-weapon-data-as-generated-file.md): no table, refreshed by a script
- [0014 Git flow](decisions/0014-git-flow.md): main, develop, feature, release, hotfix branches
- [0012 Preset permissions](decisions/0012-preset-permissions-and-cap.md): Manage Server and officer role, 25 per server

## Architecture
- [Overview](architecture/overview.md)

## Plan
- [Roadmap](plan/roadmap.md)
- [Milestones](plan/milestones.md)
- [Tasks](plan/tasks.md)
- [Next-session handoff](plan/next-session-handoff.md)
- [M0 to M3 implementation plan](plan/2026-10-06-m0-m3-implementation.md)
- [FT-015 slot builder and presets design](plan/2026-10-07-ft-015-slot-builder-design.md)
- [Roster joining, header lines and weapon icons: options](plan/2026-10-07-roster-ux-options.md): proposed, awaiting owner decisions
- [Optional weapon, build channel, PvX and Fill](plan/2026-10-08-optional-weapon-build-channel-pvx-fill.md): approved 2026-10-08, built
- [Setup redesign: any server, any channel, admin roles](plan/2026-10-08-setup-redesign.md): approved 2026-10-08, built

## Working notes
- [Open questions](open-questions.md)
- [Lessons](lessons.md)

## Process
- [Guardrails and audit](process/guardrails.md)
- [Recording rules](process/recording.md)
- [Adding the bot to a server](guides/adding-the-bot-to-a-server.md): invite steps, permissions, removing the bot
