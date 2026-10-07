---
title: The content type is chosen in the create panel, and kinds are called categories
type: decision
status: accepted
date: 2026-10-07
tags: [create, ux]
satisfies: [FR-002, FR-003, FR-023]
---

# 0016: The content type is chosen in the create panel, and kinds are called categories

## Context
FR-002 took the content type (PvP or PvE) from the forum the post was in. The owner asked on 2026-10-07 not to assume the type from the channel, and to rename "kind" to "category".

## Decision
- `/content create` works in a post of either configured forum. The panel's first menu is the type (PvP or PvE), with nothing chosen at first. The category menu stays dimmed until a type is chosen, then lists that type's categories (ADR 0010).
- Continue stays dimmed until a type is chosen. The type travels in the form's id and is stored with the content.
- Every menu starts with nothing chosen so its placeholder shows what it is for. Each option label names its field ("Type: PvP", "Category: ZvZ", "Loot vote: Off", "Preset: Name"), because Discord shows the chosen option's label instead of the placeholder.
- The user-facing word is "category" (the command option is `category`). Code, database and ADR 0010 keep the name "kind".

## Consequences
- FR-002 is changed: the forum no longer decides the type. The two forum settings still decide where `/content create` may be used.
- Presets, guided drafts (migration 0008) and the create form all carry the chosen type.
