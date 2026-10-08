---
title: Any server, any channel, and admin roles chosen in /content setup
type: decision
status: accepted
date: 2026-10-08
tags: [setup, permissions, deployment]
satisfies: [FR-002, FR-009, FR-016, FR-025]
supersedes: [FR-010]
---

# 0020: Setup without forums; admin roles

## Context
The bot was tied to one server (commands registered with `DISCORD_GUILD_ID`), to two configured forums, and to a single officer role. The owner needs to move to another server, does not want the bot to depend on channels, and wants several roles able to manage content.

## Decision (owner decisions 2026-10-08; design in docs/plan/2026-10-08-setup-redesign.md)
- **Global commands.** The slash commands are registered for the whole application. No server id is configured; the server always comes from the verified interaction. The register script empties the old per-server list once so commands are not shown twice.
- **Any place.** `/content create` works in any text channel, announcement channel, thread or forum post. PvP or PvE is chosen in the create panel. The content stays keyed by that place's id, so there is still one live content per place; a cancelled one frees the place and a finished one does not (unchanged, Q15).
- **Admin roles.** A server names up to 10 admin roles (table `guild_admin_role`). A bot admin holds one of them, or has Manage Server or Administrator. Admins and the content's creator manage any content (edit, cancel, lock, unlock, duties, attendance, end). Only admins manage presets (widens ADR 0012 from the single officer role). Anyone may create content.
- **Setup.** `/content setup` has no options. It opens a private role picker with the current admin roles preselected and saves a change at once. Only Manage Server or Administrator can use it, checked again on every click, so admin roles cannot change who the admins are. `@everyone` is refused.
- **No daily cap.** FR-010 is dropped; the one-live-content-per-place rule is the only limit.
- The old `officer_role_id` is copied into the new table by migration 0014. The old columns of `guild_settings` stay, unused.

## Consequences
- Moving to a server = invite the bot, run `/content setup`. Making the application private (Developer Portal) stops others adding it.
- The bot must have View Channel and Send Messages in each place used; otherwise creation fails with the usual "Could not create" reply and nothing is saved.
- A finished content blocks its place for good, which in a reused plain channel means one finished content per channel for now.
