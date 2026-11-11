---
title: ZvZ is a content type; every content may say where it masses
type: decision
status: accepted
date: 2026-11-11
tags: [kinds, zvz, cta, roster]
satisfies: [FR-074, FR-075]
---

# 0048: ZvZ is a content type; every content may say where it masses

## Context
After 0.31.9 the owner asked (2026-11-11) that a CTA's type is ZvZ, not PvX, and then said ZvZ is a main content type, not a subcategory. Until now ZvZ, Faction Warfare, Outpost and Castle were PvP categories. The 0.32.0 brief (question 1) had left this open. The owner also asked for a "Massing at" line, the place where the party gathers, on all content, and for the "Call to arms" line and the selection disclaimer to go.

## Decision
- `ContentType` is `pvp | pve | pvx | zvz`. ZvZ has the categories Faction Warfare, Outpost, Siege, Territory Defense, Castle and Other. PvX still holds the PvP and PvE categories only.
- The PvP categories ZvZ, Faction Warfare, Outpost and Castle stay for now, so older content and the PvP menu do not change. Moving them out of PvP is a later owner decision.
- A new CTA is stored as type ZvZ, category Other; its Type line reads `ZvZ`. CTAs posted before are not rewritten (they stay PvX).
- The event forum is set per type, now including ZvZ (`forum-type`); Plan Content has ZvZ in its Type menu; statistics count it.
- `content.massing_at` (free text, 100 characters, optional) shows as `📍 Massing at` under the host on every roster, blank content included. The host sets it with a **Massing at** button on the card and in Manage → Edit, or in the Blank form. A channel mention in it stays a link. Presets do not keep it.
- The roster drops the "Call to arms" line; the selection note is the plain sentence `Host picks the party`.
- In a CTA message each group has an icon in its title (⚔️ Party 1, 🛡️ Party 2, 💣 Bombers) and a blank line after its list; with Bombers a one-party CTA also shows the Party 1 title.

## Consequences
- Migration 0034 (type checks, `massing_at`, `slot_draft.massing`). Commands change (`forum-type`), so they are registered again after the release.
- ZvZ (0.32.0) still has the party model to reuse; the type and categories are now done.
