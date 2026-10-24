---
title: Creation card and bot-made forum posts
type: decision
status: accepted
date: 2026-10-24
tags: [create, forum, setup, permissions]
satisfies: [FR-053, FR-054, FR-002, FR-003, FR-052]
---

# 0032: Creation card and bot-made forum posts

## Context
The owner wants members to create events only through the bot (open question Q23, option A), and creation in one place with a category menu that follows the type. The 0.25.0 first form could not do that: a pop-up form's menus are fixed when it opens, and it holds five fields. The bot is HTTP-only, so it never sees a post made by hand.

## Decision
- **Creation card** (FR-054): `/content create` and a launcher's Create event button open one private message with the summary, reacting Type and Category menus, Loot vote and Preset menus, and Details (one form for the text), Guided slots, Create and Cancel. The guided cards return to it. Create lists every problem on the card and keeps what was typed. It replaces the 0.25.0 first form (FR-052, superseded) and the separate final form for creation. Details in the [design](../plan/2026-10-24-creation-card-and-forum-posts-design.md).
- **Bot-made posts** (FR-053): admins register event forums with `/content setup event-forum forum-type` (Any by default). The bot posts and pins a "📌 Create an event" launcher with a button. Members lose Create Posts in those forums (set by the owner); the bot creates each event's post, named after the title, with matching tags, and renames it when the title is edited.
- `/content create` keeps working in existing posts and channels (FR-002).

## Consequences
- Migration 0023; `setup` options change (re-register). The bot needs Create Posts, Send Messages in Posts and Manage Threads in event forums.
- Enforcement relies on the owner's forum permissions; the bot cannot stop a member who still has Create Posts.
- Supersedes ADR 0031's first form; keeps its removals (`weapon`, `slot`) and the 🏷️ Type line.
