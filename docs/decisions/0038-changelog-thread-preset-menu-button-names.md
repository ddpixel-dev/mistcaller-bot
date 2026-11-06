---
title: Changelog in a thread, Preset menu always shown, creation buttons renamed
type: decision
status: accepted
date: 2026-11-07
tags: [setup, changelog, create, presets]
satisfies: [FR-061, FR-025, FR-059]
---

# 0038: Changelog in a thread, Preset menu always shown, creation buttons renamed

## Context
Owner requests (2026-11-07): the changelog should be able to go to one existing thread or forum post, not only a channel or a forum; the Preset menu was missing on the creation card of a server with no presets (presets belong to one server); and the creation buttons needed new names.

## Decision
- `changelog-channel` also accepts a thread or forum post (channel types 10, 11, 12). Each release is posted there as messages, like a text channel. A forum still gets one post per release.
- The creation card always shows the Preset menu. With no presets it is dimmed and says to save one with `/content preset save`; a forced click only explains. This supersedes "only when the server has presets" (ADR 0031, FR-025).
- The buttons are **Plan Content** (was Normal content) and **Schedule CTA** (was Special content (CTA)). The messages that name them follow. The hub message is refreshed with the calendar, so the live buttons are renamed without a one-off.
- Changelog messages are gold cards in the roster's look (title, rule line, text).

## Consequences
- Presets stay per server; a server that wants them saves its own.
- Old changelog files keep the old button names; they describe those releases.
