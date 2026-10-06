---
title: Host on Vercel and Supabase as an HTTP-only TypeScript bot
type: decision
status: accepted
date: 2026-10-06
tags: [hosting, stack]
satisfies: [NFR-002, NFR-003, NFR-005]
---

# 0001: Host on Vercel and Supabase as an HTTP-only TypeScript bot

## Context
There is no infrastructure budget. A gateway bot needs an always-on process, which free tiers rarely give reliably. Discord can instead deliver slash commands, buttons, select menus and modals as signed HTTP requests.

## Decision
Write the bot in TypeScript as a Vercel serverless endpoint (`/api/discord`) that receives Discord interactions, with Supabase Postgres for state. Use Discord's REST API instead of `discord.js`. Rejected: a gateway bot on Oracle Always Free (sign-up risk, VM upkeep; kept as the fallback), Koyeb (card needed), Render (sleeps), Java/JDA (slower to iterate), Cloudflare Workers (reminders and rate limits fiddlier).

## Consequences
- The bot appears offline in the member list, though commands work.
- Every interaction must be acknowledged within 3 seconds, then finished by editing the message.
- No in-memory state: everything is in the database.
- Supabase may pause an inactive free project, and Vercel Hobby is non-commercial. Both are tracked as open questions and POC checks.
