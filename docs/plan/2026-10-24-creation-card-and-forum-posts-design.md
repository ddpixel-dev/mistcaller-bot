---
title: Creation card and bot-made forum posts (design and plan)
type: plan
status: approved
date: 2026-10-24
---

# Creation card and bot-made forum posts

Owner requests of 2026-10-24, agreed the same day. Decision record: [ADR 0032](../decisions/0032-creation-card-and-forum-posts.md). Requirements: FR-053 (bot-made posts), FR-054 (creation card). Open question Q23 is resolved by this design.

## Goals
1. Members create events only through the bot: they cannot create forum posts by hand, and the bot makes the post.
2. Creation happens in one place, with menus that react to each other (the category list follows the type), and the guided slot cards are optional.

## Discord limits that shape the design
- A pop-up form holds at most five fields, has no buttons, and its menus are fixed when it opens (no dependent menus).
- A message can hold reacting menus and buttons, but no text boxes.
- A form cannot open another form; a button can open a form, and a form opened from a message can update that message.
- The bot is HTTP-only (no gateway): it never sees a post created by hand, so enforcement must come from permissions.

## Part 1: the creation card (FR-054)
`/content create`, or the **Create event** button of a launcher post, answers with one private message, the **creation card**:

- **Summary** of what is set: title, start (UTC), gear tier, notes, slots, and any problems from the last Create.
- **Type** menu (PvP, PvE, PvX; limited by the forum's type, see Part 2), **Category** menu (only the categories of the chosen type; reloads when the type changes), **Loot vote** menu, **Preset** menu (only when the server has presets; picking one fills the slots).
- Buttons: **✏️ Details** (a form with Title, Start, Gear tier, Slots as typed lines, Notes, all prefilled from the card), **🧩 Guided slots**, **✅ Create**, **Cancel**.
- Prefilled at the start: the start time (now plus one hour, rounded as today) and, inside an existing post, the title (the post's name).
- **Guided slots** turn the card into the slot cards; the count is a menu (1 to 20) on the card, not a pop-up. Finish, or Back on the first card, returns to the creation card with the slots filled. Slots already set are kept: the cards open at the end and Back walks through them.
- **Create** checks everything (type chosen, title, start in the future, gear tier, 1 to 20 slots, notes). Problems are listed on the card; nothing typed is lost, so the forms' Fix and retry is not needed for creation.
- State lives in the member's draft (`slot_draft`, one per member per place, one hour), extended with title, start text, notes, slot text (kept when the typed slots do not parse) and the target forum (migration 0023). The type may be empty until chosen.
- Replaces the 0.25.0 first form and the separate final form. Old forms and panels still answer with "run `/content create` again". The edit form and Fix and retry for editing are unchanged.

## Part 2: bot-made forum posts (FR-053)
- **Setup**: `/content setup event-forum:<forum> forum-type:<PvP|PvE|Any>` (admins). The type defaults to Any. The bot creates a post **"📌 Create an event"** holding a short how-to and a **Create event** button, pins it, and stores the forum (`event_forum`: guild, forum, type, launcher post). Setting the forum again replaces its launcher post and type. `clear-event-forum:<forum>` deletes the launcher post and forgets the forum. The reply lists the permissions to set.
- **Permissions (set by the owner)**: in each event forum, @everyone: deny Create Posts, allow Send Messages in Posts. The bot: allow Create Posts, Send Messages in Posts and Manage Threads (to pin).
- **Create event**: opens the creation card inside the launcher post, with the target forum stored in the draft. A forum typed PvP offers PvP and PvX; PvE offers PvE and PvX; Any offers all three.
- **Create** in a launcher: the bot creates a new post in the forum named after the title, with the roster as its first message, then saves the content (thread and message id are the new post's id). Tags: the forum's tags whose name matches the type (PvP, PvE, PvX) or the category label, ignoring case; the bot never creates tags. On failure the post and the row are removed, as creation already does. The card then shows "✅ Created" with a link.
- **Rename**: content in a bot-made post (`content.own_post`, migration 0023) renames its post when Edit details changes the title. Discord allows two renames per ten minutes; when refused, the reply says so and the roster still changes.
- `/content create` keeps working in existing posts and channels, and is refused inside a launcher post.

## Out of scope
Archiving or locking posts when content ends or is cancelled; creating forum tags; a gateway bot.

## Plan
1. Migration 0023: `slot_draft` columns (title, start_text, notes, slots_text, target_forum_id; type nullable), `content.own_post`, table `event_forum` with RLS and anon/authenticated revoked. Tests: migration, draft round trip.
2. Rest: optional `createForumPost`, `getChannel`, `editChannel`, `deleteChannel`; tests with a fake fetch.
3. Domain: card validation (pure) returning every problem; forum tag matching; type choices by forum type. Unit tests.
4. Render: the creation card (classic message, five rows at most) and the launcher message. Limit tests.
5. Handlers: `/content create` and the launcher button open the card; card menus and buttons (`cc:`), the Details form (`ccd:`), Create (existing place or new forum post with tags and cleanup); guided cards return to the card, count as a menu. Handler tests through dispatch.
6. Setup: `event-forum`, `forum-type`, `clear-event-forum`; the launcher post and pin; tests.
7. Rename on edit for bot-made posts; tests.
8. Help, PRODUCT, ADR 0032, open question Q23 resolved, index; full test run; release 0.26.0 (migration first, deploy, register).
