---
title: The bot has the Message Content intent
type: decision
status: accepted
date: 2026-11-10
tags: [security, discord, cta]
satisfies: [FR-069, NFR-001]
---

# 0046: The bot has the Message Content intent

## Context
FR-069 forwards an admin's message under every CTA (ADR 0045). A live test on 2026-11-10 showed that without the privileged Message Content intent the bot reads a member's message as empty, and Discord refuses to forward it: `403, code 160014: You cannot forward a message whose content you cannot read`. NFR-001 said the bot has no privileged intents.

## Decision
- The owner turned on the **Message Content** intent in the Discord developer portal (2026-11-10). Discord reviews it once the bot reaches 10,000 users.
- The bot has no gateway connection, so it reads a message only when its code fetches one. Today that is the `cta-msg` setup check; Discord reads the source itself when it builds the forward.
- The bot stores only channel and message ids, never message text, and never logs text.
- NFR-001 now reads "no privileged intents except Message Content (ADR 0046)".
- A forward was tested live after the change: a member's message read (72 characters) and forwarded (HTTP 200, snapshot with the text), then deleted.

## Consequences
- Any later feature that reads message text needs the same rules: fetch only what it needs, store ids not text, log no text.
- Near 10,000 users the owner applies for the intent or FR-069 falls back to a bot-written source.
