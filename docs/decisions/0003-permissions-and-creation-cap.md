---
title: Anyone creates content; creator, server admins and the officer role manage it
type: decision
status: accepted
date: 2026-10-06
tags: [permissions]
satisfies: [FR-009, FR-010]
---

# 0003: Anyone creates content; creator, server admins and the officer role manage it

## Context
Content is posted by officers and ordinary members alike. Open creation invites spam, and a creator may be absent when a change is needed.

## Decision
Any member may create content, but only inside a configured forum and at most 5 times per rolling 24 hours (a guild setting). The creator, any member with Manage Server, and any member with the officer role can edit, lock, cancel and mark attendance. Rejected: officer-only creation.

## Consequences
- `officer_role_id` is stored in guild settings and grants management only.
- Every management action checks `created_by`, the Manage Server permission, or the officer role against the verified interaction.
