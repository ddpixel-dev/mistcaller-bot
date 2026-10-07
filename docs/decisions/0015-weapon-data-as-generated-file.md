---
title: Weapon data is a generated file in the repo, not a table
type: decision
status: accepted
date: 2026-10-07
tags: [data, weapons]
satisfies: [FR-026]
---

# 0015: Weapon data is a generated file in the repo, not a table

## Context
ADR 0009 planned to store a weapon snapshot in the database. The spike (2026-10-07) found only 155 base weapons (about 17 KB as data) in `formatted/items.txt`. NFR-004 says every table carries a guild id, which game reference data does not have.

## Decision
`scripts/import-weapons.ts` downloads `formatted/items.txt` and writes `src/data/weapons.ts`, a checked-in file with each weapon's base id, display name (tier word removed), slot class and icon tier, plus the source URL and fetch date. The bot reads this file. Pure parsing and search live in `src/domain/weapons.ts`. Icons are links built from the base id (ADR 0013). The importer refuses to overwrite the file if fewer than 100 weapons parse.

## Consequences
- No table, no migration and no query for a search, so autocomplete is fast and works without the database.
- A refresh is: run the script in Docker, review the diff, commit and deploy. New weapons appear only after a refresh.
- Supersedes the "stored in our own database" detail of 0009; its source, adapter and no-license notes still hold.
- The data repository has no license file, so the rights stay unconfirmed, as in 0009.
