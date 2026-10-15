---
title: Fix and retry for the create and edit forms; one build reference option
type: decision
status: accepted
date: 2026-10-09
tags: [forms, creation, build]
satisfies: [FR-036, FR-031, FR-002, FR-020]
---

# 0025: Fix and retry for the create and edit forms; one build reference option

## Context
Owner requests of 2026-10-09. (1) A mistake in the create form (a date, a slot line) closed the form and returned one error, so the whole form had to be typed again. (2) Builds are often posted inside forum posts, and the `build-channel` picker takes a channel, not a post.

## Decision
- **No in-form validation.** Discord cannot validate inside an open form: submitting closes it, and the bot cannot reopen a form as the answer to a form submit. Instead the bot answers with **all** mistakes at once and a **Fix and retry** button that opens the same form again with what the member typed (FR-036). The text is kept in `form_retry` (one row per member and post, replaced by a new failure, purged after an hour with the old drafts; migration 0018). Only the member who made the mistakes can reopen it. The same flow serves `/content edit`, including the "a held position cannot be removed" refusal.
- **One build reference (FR-031, supersedes the `build-channel` option).** The optional `build-reference` option of `/content create` and `/content edit` takes a Discord link to a channel, thread, forum post or message of the same server. Links of another server or other sites are refused (the roster never shows an arbitrary web link). A channel, thread or post is stored as its id and shown as a clickable mention; a message is stored as `channel/message` and shown as a `Build message` link. `clear-build` still removes it. The existing column `build_channel_id` holds the value, so there is no schema change for this part; earlier plain channel ids stay valid.
- **Ids.** Button and form ids are limited to 100 characters, so the reference is packed in base 36 inside them (`r<channel>[.<message>]`), and a panel made before this release (plain id) still works. The new category `Avalonian gold chest` uses the short id `gold-chest` for the same reason.

## Consequences
- Migration 0018 (`form_retry`). Commands changed (re-register): `build-channel` removed, `build-reference` added.
- The old option disappears from the command list at once; roster messages that already show a channel keep working.
- A reference is not checked against Discord (the bot does not look the channel or message up). A deleted target shows as an unknown channel or a dead link.
