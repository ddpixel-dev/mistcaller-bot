---
title: Run all third-party tools in Docker and keep dependencies minimal
type: decision
status: accepted
date: 2026-10-06
tags: [tooling, dependencies]
satisfies: [NFR-003, NFR-007]
---

# 0006: Run all third-party tools in Docker and keep dependencies minimal

## Context
The owner does not want third-party tools installed on their machine unless they are asked first, and wants Docker used for any third-party tool.

## Decision
Every `npm`, script and test command runs in a `node:24` container through Docker Compose. The test database is a `postgres:16` container. Nothing is installed on the host. Prefer Node built-ins (`node:test`, `node:crypto`, `fetch`, native TypeScript type stripping) over packages. Each package is proposed in the plan and added only after the owner approves it. Proposed so far: `postgres` (database client), and `typescript` plus `@types/node` for type checking only. Rejected: `discord-interactions` and `discord-api-types` (signature checking uses `node:crypto`, types are written by hand), `vitest` (replaced by `node:test`), `@vercel/functions` (all work finishes before the response), Vercel CLI and Supabase CLI (deploys go through Git and migrations through our own runner).

## Consequences
- Source uses erasable TypeScript syntax and explicit `.ts` import specifiers, which Vercel's build must accept. If it does not, the owner is asked before any bundler is added (open question Q11).
- Scripts that talk to Supabase or Discord also run in the container, with `.env` passed in.
