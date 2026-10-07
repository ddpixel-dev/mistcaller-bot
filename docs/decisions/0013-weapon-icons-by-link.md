---
title: Weapon icons are linked from the render service, not uploaded
type: decision
status: accepted
date: 2026-10-07
tags: [icons, weapons, rights]
satisfies: [FR-026]
supersedes: 0011
---

# 0013: Weapon icons are linked from the render service, not uploaded

## Context
ADR 0011 proposed uploading weapon icons as Discord application emoji. The owner tried linking the render service URLs (`https://render.albiononline.com/v1/item/{ITEM_ID}.png`, with `size` and `quality`) directly and reports that it works, and prefers it as simpler.

## Decision
Icons are linked by URL from Albion's render service. Nothing is uploaded or stored. The URL is built from the `ao-bin-dumps` item ID inside the provider adapter, so the host can be swapped in one place. The weapon icon appears beside the role and weapon name as the owner described.

## Consequences
- No copying of game art, so the rights concern is smaller than for uploads. It is not zero: the owner may still confirm with Sandbox Interactive.
- Icons depend on the render host being up. If it fails, the roster still shows the role and weapon name.
- Exactly where Discord shows a linked image (embed thumbnail, image or other parts of the message) is checked when FT-015 is designed, with a test message. Discord does not draw images inline inside embed text, so the owner's working setup is the reference for the layout.
- Supersedes 0011. The 2000-emoji limit and upload script no longer matter.
