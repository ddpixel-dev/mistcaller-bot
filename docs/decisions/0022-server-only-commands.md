---
title: The slash commands are server-only, so the bot works in any server it is added to
type: decision
status: accepted
date: 2026-10-08
tags: [deployment, discord, onboarding]
satisfies: [FR-002]
---

# 0022: Server-only commands

## Context
The commands were registered globally (ADR 0020) with Discord's defaults, which also allow an install to an account ("Add to my apps"). A second server where the bot was installed that way showed the commands, but the bot was not a member, so it could not post and creation failed with a vague message (lessons, 2026-10-08).

## Decision (owner request 2026-10-08)
- The `content` command declares `integration_types: [0]` (server install only) and `contexts: [0]` (server channels only), so it never appears in direct messages or for an account install.
- Before saving anything, creation checks the install type and the bot's permissions that Discord sends with the interaction, and explains the problem (FR-002).
- Nothing in the bot is tied to one server: every table is keyed by server id, the cron jobs read all servers, and the weapon emoji belong to the application. Onboarding another server is documented in `docs/guides/adding-the-bot-to-a-server.md`.

## Consequences
- The application's Installation settings should have Guild Install enabled (User Install is not needed).
- A change to the commands needs `npm run register` (global registration; it can take a few minutes to show).
