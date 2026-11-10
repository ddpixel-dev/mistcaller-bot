---
title: Creation hub in content-management; blank content
type: decision
status: accepted
date: 2026-11-06
tags: [create, calendar, cta]
satisfies: [FR-059, FR-060]
---

# 0036: Creation hub in content-management; blank content

## Context
Creation starts from a pinned launcher post in each event forum (ADR 0032, 0033) or `/content create`. The owner asked (2026-11-06) for creation buttons in the calendar channel, renamed content-management, a CTA type only some roles can create, and a quick blank type.

## Decision
- The first message of the content-management channel carries **Normal content** and **Special content (CTA)** buttons; both open the creation card. Normal posts to the forum of its type, CTA to a CTA channel. `/content create` and the launcher post are removed (supersedes the launcher of ADR 0032 and 0033).
- CTA is limited to `cta-roles` (admins always allowed); `cta-channel` and `cta-roles` are `/content setup` options.
- **Blank content** (Title, Start, Gear tier, Description) is offered in both flows, skips the card, has no roster, and is posted and listed like other content. A normal blank asks for PvP or PvE first, to choose the forum.

## Consequences
- One way to create content, so rules (type forums, tags, CTA roles) apply everywhere.
- Existing launcher posts are cleaned up at release. Content created before stays untouched.

## Amended during the build (2026-11-06)
- The creation buttons are a **message of their own above the calendar** (owner request), not part of the calendar's first message. The refresh writes it first, so the existing first message becomes the buttons and the calendar follows below it.
- **The CTA channel is a text channel**, set with `cta-channel` (owner clarification). Each content needs its own post (FR-019, one content per post), and the host actions find a content by the channel they are used in, so each CTA gets its own thread: the bot posts an announcement in the channel, starts a thread from it, and the roster is the first message in that thread. The announcement shows the title and start; it is not updated by later edits. The thread is renamed with the title, like a bot-made forum post.
- **Blank** is the **Blank template** button on the creation card, so the type, or the CTA choice, is already known. Gear tier stays required, like normal content.
- The CTA roles are chosen in a second role picker in `/content setup`; admins always may.
- Old launcher posts are removed with `scripts/remove-launchers.ts` at release. `/content create` is unregistered and unrouted; its handler and tests remain as dead code to clean up.

## Update 2026-11-10: a CTA card of its own (owner decision)
Schedule CTA opened the same card as Plan Content, with Type and Category menus that mean nothing for a CTA. From release 0.31.8 the CTA card hides Type and Category; a CTA is stored as PvX with the category Other, as the Blank CTA already was. Title, start, gear tier, loot vote, sign-up mode, presets, Blank template and the Parties choice (ADR 0044) stay. Normal content is unchanged.
