---
title: The pinned CTA message is copied at creation from a message link
type: decision
status: accepted
date: 2026-11-10
tags: [cta, setup, discord]
satisfies: [FR-069]
---

# 0045: The pinned CTA message is copied at creation from a message link

## Context
The owner wants a fixed message (with channel mentions) under every CTA roster, pinned, without attaching it each time (2026-11-10). Discord has no live reference to a message, and the bot has no gateway, so it never hears about edits. Full design: [the design](../plan/2026-11-10-cta-pinned-message-and-parties-design.md).

## Decision
- `/content setup cta-msg:<message link>` and `clear-cta-msg` (admins) store the channel and message IDs in `cta_message` (migration 0031). The link must be from the same server and readable by the bot.
- When a CTA is created the bot copies the source into a separate message below the roster (below both rosters when there are two parties) and pins it. The copy is made at creation only; older CTAs keep their text.
- Text and embeds are copied with mentions disabled; channel mentions keep working because they are plain text and never ping. Attachments become links.
- A missing source or a failed pin never blocks the CTA; the creator gets a private note.

## Consequences
- The bot needs Read Message History on the source channel and **Pin Messages** in the CTA channel.
- Commands must be registered again after release.
- Not built: refreshing old CTAs when the source is edited.

## Update 2026-11-10: forwarded, not copied (owner decision)
The final review found that the bot cannot read another member's message: Discord's privileged Message Content intent also applies to REST reads, and the bot has it off (NFR-001: no privileged intents). A copy would always be empty. The owner chose forwarding over turning the intent on.
- Replaces the third and fourth Decision bullets: the bot **forwards** the source into the CTA thread (`message_reference` type 1, forward) and pins the forward. Discord makes the snapshot, so the bot never reads the text. Text, embeds, attachments and channel links come with it; mentions in a forward never ping. Players see Discord's "Forwarded" label.
- Setup checks that the linked channel belongs to this server (`GET /channels/{id}`, its `guild_id`) and that the message exists and the bot can open it. It cannot check the text.
- The forward runs alongside the calendar refresh to stay inside the 3-second reply.
- NFR-001 is unchanged.
