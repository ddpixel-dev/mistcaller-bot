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
