---
title: Weapon icons as application emoji from the Albion render service
type: decision
status: accepted
date: 2026-10-07
tags: [icons, weapons, rights]
satisfies: [FR-026]
---

# 0011: Weapon icons as application emoji from the Albion render service

## Context
The owner wants a small weapon icon beside the weapon name and role on every roster line (Q19). Discord cannot show an arbitrary image inline in embed text. Only emoji render inline. Server emoji slots are far too few for hundreds of weapons, but Discord's application-owned emoji allow up to 2000 per app, usable in any server without taking server slots (found by search 2026-10-07; to re-check against the Discord emoji docs at design time).

The owner pointed to Albion's render service, `https://render.albiononline.com/v1/item/{ITEM_ID}.png` (parameters `size` and `quality`, enchantment in the ID). Item IDs come from `ao-bin-dumps` (0009). I could not confirm the service's terms for external tools; the claim that it exists for external integrations comes from the owner's source and is unverified.

## Decision
Weapon icons are fetched through a provider adapter from the render service and uploaded once as application emoji, one per base weapon (one tier). Roster lines show role emoji, weapon emoji and weapon name. The guided slot builder may also show a larger icon. The mapping from weapon to emoji ID is stored in our own database. The upload is a seed script, not a runtime step.

## Consequences
- Uploading copies game art to Discord, which is a stronger use than linking. The rights are **unconfirmed**. FR-022 says no third-party game art without permission, so the owner confirms with Sandbox Interactive before the feature ships. If refused, the roster falls back to role emoji and weapon names only.
- A weapon without an emoji (new weapon, failed upload) shows its name only.
- The 2000 limit and weapon count (a few hundred base weapons, to be counted at design time) must be checked before building.
- Emoji names are limited to 2 to 32 letters, digits and underscores, so IDs need a name mapping.
