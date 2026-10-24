---
title: Start menus on the creation card, Roles, locked launcher post
type: decision
status: accepted
date: 2026-10-24
tags: [create, forum, card]
satisfies: [FR-053, FR-054]
---

# 0033: Start menus on the creation card, Roles, locked launcher post

## Context
After 0.26.0 the owner asked (2026-10-24) to stop members writing in the pinned launcher post, to keep as much as possible in the private card instead of the Details pop-up, to make the Create event button visible from the forum list, to rename Guided slots to Roles with a hint, and to let Back on the first slot change the number again.

## Decision
- **Start as menus**: the card holds Day (today and the next 13 days, UTC), Hour and Minute (quarters) menus; the card shows the start in UTC and in the viewer's time. The card starts at now plus one hour, rounded up to a quarter. Details keeps only Title, Gear tier, Slots and Notes, because Discord messages cannot hold text boxes.
- **Components V2 card**: a classic message holds five rows, and the card needs more, so the card and the slot cards are Components V2 messages (the weapon picture is a thumbnail beside the slot card's text).
- **Roles**: the Guided slots button is named Roles, and the card says it builds the slots step by step instead of typing them in Details. Back on the first slot shows the number menu; its Back to the card returns to the card.
- **Launcher post**: named "📌 Create an event: click here", its first line says to press Create event (the forum list shows only a post's title and the start of its first message, never buttons), and it is pinned and **locked** so only Manage Threads can write in it; the button still works. The setup reply gives a line to paste into the forum's Post Guidelines linking to the post.

## Consequences
- No migration. Cards opened before this release (classic messages) should be closed and opened again.
- Existing launcher posts keep their old name and stay unlocked until `/content setup event-forum` is run again for the forum.
