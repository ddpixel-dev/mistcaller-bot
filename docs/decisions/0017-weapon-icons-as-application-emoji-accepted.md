---
title: Weapon icons are uploaded as application emoji (owner accepts the rights risk)
type: decision
status: accepted
date: 2026-10-07
tags: [icons, weapons, rights]
satisfies: [FR-026]
supersedes: 0013
---

# 0017: Weapon icons are uploaded as application emoji

## Context
The owner wants the roster line to read `roleIcon Role - WeaponIcon Weapon - Duty · Sworn: Player`, with the actual icon fetched from the Albion render service beside the weapon name. Discord draws an image inside a line of text only as an emoji (ADR 0013 chose linking, which can only show an icon as a thumbnail, never beside the name).

## Decision
`scripts/sync-emoji.ts` uploads each weapon's icon (`render.albiononline.com/v1/item/T<tier>_<base>.png?size=128`, at most about 40 KB each, limit 256 KB) once as an application emoji named `w_<base>`, and writes the ids to `src/data/weapon-emoji.ts`. Discord allows 2,000 application emoji per app, usable in any server without server slots. The roster text, menu options and buttons use them. A weapon without an emoji (a new weapon, or one the render service has no icon for, such as Black Hands) shows its name only.

The owner confirmed on 2026-10-07 that uploading is accepted. This copies game art into Discord, so the rights to do so rest with the owner; the owner may still ask the publisher. Removing the emoji later is a delete in the Discord developer portal.

## Consequences
- Supersedes 0013 for the roster. Linking (ADR 0013) stays for the thumbnail on the guided card and `/content weapon`.
- A data refresh (`scripts/import-weapons.ts`) that adds weapons needs `scripts/sync-emoji.ts` run again; it only uploads what is missing.
- ADR 0011 (the first emoji proposal) stays superseded by 0013; this record is the current decision.
