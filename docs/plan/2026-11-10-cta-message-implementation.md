---
title: CTA pinned message implementation plan
type: plan
status: proposed (awaiting owner review)
date: 2026-11-10
satisfies: [FR-069]
---

# CTA pinned message Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every CTA gets a copy of an admin-configured message as a separate, pinned message below the roster.

**Architecture:** A `cta_message` row stores the source channel and message IDs. Pure domain code parses the link and builds the copy. The REST wrapper gains `getMessage`. The setup handler stores the link; `publish()` posts and pins the copy after the roster and reports skipped steps as notes.

**Tech Stack:** TypeScript on Node 24 (type stripping), `postgres`, `node:test`. No new dependency (ADR 0006).

**Spec:** [2026-11-10-cta-pinned-message-and-parties-design.md](2026-11-10-cta-pinned-message-and-parties-design.md), Part 1; ADR 0045; FR-069.

## Global Constraints

- Branch `feature/cta-message` from `develop` (ADR 0014). Say which branch you are on.
- Run every tool in Docker: `docker compose run --rm node npm test` and `docker compose run --rm node npx tsc --noEmit`. One file: `docker compose run --rm node node --test tests/domain/ctamsg.test.ts`. Never install anything on the host.
- Migration `0031_cta_message.sql`; never edit a migration after it ran on production. Row level security on, anon revoked, a `guild_id` column (NFR-004).
- The copy is sent with `allowed_mentions: { parse: [] }`. Channel mentions `<#id>` stay as typed.
- Admins only for the setting. The link's guild must equal the interaction's guild. Never log the message text.
- Command option descriptions under 100 characters (`tests/discord/commands-limits.test.ts`).
- Domain code has no Discord or database imports (NFR-007). Keep no state in memory (NFR-005).
- A missing source or a failed pin never blocks the CTA; the creator gets a private note.
- Write the changelog in players' language, with how-to steps.

## Review Focus

- A source message with no text and no rich embeds (only attachments, or a Components V2 message): the copy has attachment links, or the step is skipped with a note. It never posts an empty message.
- A source longer than 2000 characters after attachment links are added: cut at a line boundary, never past 2000, never a rejected request.
- Link-preview embeds on the source (type `link`, `image`, `video`): not copied, because Discord regenerates them from the URLs.
- A thread or forum-post message link as the source: accepted (the channel ID in the link is the thread's).
- The source contains `@everyone`, a role mention and a user mention: all inert in the copy, the `<#channel>` mention intact.

## File Structure

- Create `supabase/migrations/0031_cta_message.sql`.
- Create `src/domain/ctamsg.ts`: link parser and copy builder.
- Create `src/handlers/ctamsg.ts`: `postCtaMessage`, used by `publish()`.
- Modify `src/db/cta.ts`, `src/discord/rest.ts`, `src/discord/commands.ts`, `src/handlers/setup.ts`, `src/handlers/create.ts`, `src/handlers/card.ts`, `src/handlers/help.ts`, `tests/helpers/db.ts`.
- Tests: `tests/domain/ctamsg.test.ts`, `tests/db/cta.test.ts`, `tests/discord/rest.test.ts`, `tests/handlers/setup.test.ts`, `tests/handlers/card.test.ts`, `tests/handlers/ctamsg.test.ts`.

---

### Task 1: Link parser and copy builder (pure)

**Files:** Create `src/domain/ctamsg.ts`, `tests/domain/ctamsg.test.ts`.

**Interfaces:**
- Produces: `parseMessageLink(text: string, guildId: string): Result<{ channelId: string; messageId: string }>`
- Produces: `type SourceMessage = { content: string; embeds: { type?: string; [k: string]: unknown }[]; attachments: { url: string }[]; flags?: number }`
- Produces: `buildCtaCopy(src: SourceMessage): { content?: string; embeds?: unknown[]; allowed_mentions: { parse: never[] } } | null` (null means nothing to copy)
- Produces: `CTA_COPY_LIMIT = 2000`

- [ ] **Step 1: Write the failing tests** in `tests/domain/ctamsg.test.ts` (Result type is in `src/domain/types.ts`):
  - `parseMessageLink` accepts `https://discord.com/channels/G/C/M`, the `discordapp.com`, `ptb.` and `canary.` hosts, and surrounding spaces or `<...>` angle brackets.
  - It returns `{ ok: false }` with a message for: another guild id, `@me`, a link with two parts, a non-numeric id, text that is not a URL, an empty string.
  - `buildCtaCopy({ content: "Read <#123> and @everyone", embeds: [], attachments: [] })` returns `content` unchanged and `allowed_mentions` deep-equal to `{ parse: [] }`.
  - Attachments are appended as lines of urls after the text; content plus links is cut at a line boundary to 2000 characters or fewer.
  - Embeds with `type` `"rich"` are kept; `link`, `image`, `video`, `gifv` are dropped.
  - Returns `null` when there is no text, no rich embed and no attachment, and when `flags` has bit `1 << 15` set and there is no text.
- [ ] **Step 2: Run** `docker compose run --rm node node --test tests/domain/ctamsg.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** both functions in `src/domain/ctamsg.ts`. Parse with one regular expression; cut by dropping whole trailing lines, and if a single first line is over the limit, slice it to 1999 characters plus `…`.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: CTA message link parser and copy builder (FR-069)`.

### Task 2: Storage

**Files:** Create `supabase/migrations/0031_cta_message.sql`. Modify `src/db/cta.ts`, `tests/helpers/db.ts` (add `cta_message` to the truncate list), `tests/db/cta.test.ts`. Check `tests/db/anon-tables.test.ts` and `scripts/anon-tables.ts`: they list tables and need the new one if they enumerate.

**Interfaces:**
- Produces: `getCtaMessage(sql: Sql, guildId: string): Promise<{ channelId: string; messageId: string } | null>`
- Produces: `setCtaMessage(sql: Sql, guildId: string, channelId: string, messageId: string): Promise<void>` (upsert)
- Produces: `clearCtaMessage(sql: Sql, guildId: string): Promise<boolean>`

- [ ] **Step 1: Write the failing tests** in `tests/db/cta.test.ts`: get returns `null` before setting; set then get returns both ids; setting again replaces; another guild is unaffected; clear returns `true` once and `false` after; `anon` has no privileges on the table (follow how `cta_channel` is tested).
- [ ] **Step 2: Run** `docker compose run --rm node node --test tests/db/cta.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write the migration** (`guild_id text primary key`, `channel_id text not null`, `message_id text not null`, `updated_at timestamptz not null default now()`, row level security on, the same anon revoke block as `cta_channel` in migration 0027) and the three functions, modelled on `getCtaChannel`, `setCtaChannel` and `clearCtaChannel`.
- [ ] **Step 4: Run** the same command plus `tests/db/anon-tables.test.ts` and `tests/db/migrate.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: cta_message table (migration 0031)`.

### Task 3: Reading a message over REST

**Files:** Modify `src/discord/rest.ts`, `tests/discord/rest.test.ts`.

**Interfaces:**
- Consumes: `SourceMessage` from Task 1.
- Produces on `Rest`: `getMessage?(channelId: string, messageId: string): Promise<{ ok: true; message: SourceMessage } | { ok: false; reason: "missing" | "forbidden" }>`

- [ ] **Step 1: Write the failing tests** (follow the existing fake-fetch style in `tests/discord/rest.test.ts`): a 200 maps to `ok: true` with `content`, `embeds` and `attachments`; 404 maps to `missing`; 403 maps to `forbidden`; a 500 throws like the other methods; the request is `GET /channels/{c}/messages/{m}`.
- [ ] **Step 2: Run** `docker compose run --rm node node --test tests/discord/rest.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `getMessage`** next to `pinMessage`. Look at how `call(method, path, body, ignoreStatuses)` handles 404; map 403 by catching `DiscordApiError` with `status` 403.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: Rest.getMessage`.

### Task 4: The setup option

**Files:** Modify `src/discord/commands.ts`, `src/handlers/setup.ts`, `tests/handlers/setup.test.ts`, `tests/discord/commands-limits.test.ts` (it should already cover new options).

**Interfaces:**
- Consumes: Tasks 1 to 3.
- Produces: setup options `cta-msg` (string) and `clear-cta-msg` (boolean), `CtaSettings` gains `message: { channelId: string; messageId: string } | null`.

- [ ] **Step 1: Write the failing tests** in `tests/handlers/setup.test.ts`, modelled on the `cta-channel` tests: a valid link is fetched with `getMessage` and stored; a link from another guild is refused and nothing is stored; `missing` and `forbidden` are refused with text naming View Channel and Read Message History; a non-admin is refused; `clear-cta-msg` removes it; the setup panel text shows `CTA message: <link>` or `none`; setting is refused when `rest.getMessage` is absent.
- [ ] **Step 2: Run** `docker compose run --rm node node --test tests/handlers/setup.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the two options to the `setup` subcommand in `commands.ts` (descriptions under 100 characters, for example `Link of the message pinned under every CTA`). In `setup.ts` extend the `ctaGiven` handling and `setupPanel`.
- [ ] **Step 4: Run** the setup and `commands-limits` tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat: cta-msg and clear-cta-msg setup options`.

### Task 5: Posting and pinning the copy

**Files:** Create `src/handlers/ctamsg.ts`, `tests/handlers/ctamsg.test.ts`. Modify `src/handlers/create.ts` (`publish`, `PublishInput`, its return type), `src/handlers/card.ts` (`create`, `handleBlankForm`), `tests/handlers/card.test.ts`.

**Interfaces:**
- Consumes: `getCtaMessage` (Task 2), `Rest.getMessage` (Task 3), `buildCtaCopy` (Task 1), existing `Rest.createMessage` and `Rest.pinMessage`.
- Produces: `postCtaMessage(deps: Deps, a: { guildId: string; threadId: string }): Promise<string[]>` returning the notes for steps that were skipped (empty when all went well).
- Produces: `publish()` returns `{ ok: true; threadId; messageId; notes: string[] }`.

- [ ] **Step 1: Write the failing tests** in `tests/handlers/ctamsg.test.ts` with a recording fake `Rest`: no setting stored makes no calls and returns `[]`; with a setting the order of calls is `getMessage`, `createMessage` (to the thread, with the copy body), `pinMessage` (the new id); `missing` and `forbidden` give one note each and no `createMessage`; a `null` copy gives a note and no post; a failing `pinMessage` gives a note and the message stays; a failing `createMessage` gives a note and does not throw. In `tests/handlers/card.test.ts`: a CTA created through Create and through the Blank form calls `postCtaMessage` after the roster is posted and pinned, a normal content never does, and the private "✅ Created" reply ends with the notes when there are any.
- [ ] **Step 2: Run** the two files. Expected: FAIL.
- [ ] **Step 3: Implement `postCtaMessage`** and call it at the end of `publish()` only when `a.cta` is true, after the roster message is pinned (look for the existing `pinMessage` call, FR-063). Add the notes to the replies in `card.ts` (lines near 266 and 310).
- [ ] **Step 4: Run** `docker compose run --rm node npm test`. Expected: all PASS; then `docker compose run --rm node npx tsc --noEmit`. Expected: no errors.
- [ ] **Step 5: Commit** `feat: pin a copy of the CTA message under every CTA (FR-069)`.

### Task 6: Help, changelog, records

**Files:** Modify `src/handlers/help.ts` (+ its test), `PRODUCT.md` (FR-069 status, Current state), `docs/INDEX.md`, `docs/plan/next-session-handoff.md`. Create `changelog/<version>.md` at release time.

- [ ] **Step 1: Write the failing test** in `tests/handlers/help.test.ts`: the help text mentions `cta-msg`.
- [ ] **Step 2: Run** the help test. Expected: FAIL.
- [ ] **Step 3: Update the help text** and the setup reply that lists permissions so it names **Pin Messages** (CTA channel) and Read Message History (source channel).
- [ ] **Step 4: Run** `docker compose run --rm node npm test`. Expected: PASS. Update `PRODUCT.md` FR-069 to `built` with the release number and run the audit in `docs/process/guardrails.md`. Expected: no new lines.
- [ ] **Step 5: Release** as in the checklist of `2026-11-06-zvz-brief.md`: `release/x.y.z`, bump `package.json` and `package-lock.json`, `scripts/migrate.ts` (migrate production **before** the code is used, though this migration is additive), merge, tag, push, wait for the Vercel build to be READY, run `scripts/register-commands.ts`, write `changelog/x.y.z.md` (how to set `cta-msg`, what players see, the Pin Messages permission), `scripts/post-changelog.ts x.y.z --dry-run`, then without the flag. Commit `docs: help, FR-069 built`.
