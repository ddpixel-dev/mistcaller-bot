---
title: Git flow for features and releases
type: decision
status: accepted
date: 2026-10-07
tags: [process, git]
---

# 0014: Git flow for features and releases

## Context
The POC lived on one branch and was merged to `main` by hand. The owner asked that every new requirement, feature, MVP step and release follow git flow, with the agent managing the git state.

## Decision
- `main` holds released code only. Vercel production and the cron workflow run from it. Each release is tagged `vMAJOR.MINOR.PATCH`.
- `develop` is the integration branch. Feature work merges here.
- `feature/<id>-<short-name>` branches start from `develop` (one per FT or FR, for example `feature/ft-012-one-content-per-post`) and merge back with `--no-ff`. Documentation-only changes use `feature/docs-...` or go straight to `develop` when tiny.
- `release/<version>` starts from `develop` when a milestone is ready, gets only fixes and version notes, then merges into `main` (tagged) and back into `develop`.
- `hotfix/<name>` starts from `main` for production fixes, merges into `main` (tagged) and into `develop`.
- Commits use short conventional prefixes (`feat:`, `fix:`, `docs:`, `test:`). The agent keeps the branches and tags tidy and says which branch it is on.
- Pushing `main` or tags is a release. The agent does it only when the owner has agreed to the release; feature and `develop` pushes follow the standing instruction to manage git state.

## Consequences
- Vercel makes preview deployments for `develop` and feature branches. They don't touch the live Discord endpoint, which points at production.
- The old `poc/m0-m3` branch stays as history.
