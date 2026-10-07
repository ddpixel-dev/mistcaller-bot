---
title: Weapon list from ao-bin-dumps through a provider adapter
type: decision
status: accepted
date: 2026-10-07
tags: [data, weapons]
satisfies: [FR-026]
---

# 0009: Weapon list from ao-bin-dumps through a provider adapter

## Context
The owner pointed to the `ao-bin-dumps` repository as the source for the weapon list. An earlier spike (in the separate Albion hub project) found: it is game data only, with names, IDs and categories; it has no icons; GitHub reports no license; and it is large, with an English localization file of about 94 MB that must be streamed. Third-party data should enter through an adapter and be stored with its source and version.

## Decision (accepted by the owner 2026-10-07)
Build a small import that reads the weapon category from `ao-bin-dumps`, keeps only weapon names, IDs, weapon class and tier, and stores that snapshot in our own database with its source and fetch date. The bot reads the snapshot, never the repository, at run time. Icons are decided separately in [0011](0011-weapon-icons-as-application-emoji.md).

## Consequences
- The snapshot is refreshed by hand when the game changes, so a new weapon appears only after a refresh.
- The repository has no license file. The data is used as a community-standard source, and the rights stay unconfirmed (see 0011).
