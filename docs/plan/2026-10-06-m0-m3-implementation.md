---
title: M0 to M3 implementation plan (POC)
type: plan
status: draft
date: 2026-10-06
---

# Content Roster Bot, M0 to M3 (POC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Discord bot, deployed free on Vercel and Supabase, that creates content rosters in forum posts, lets members sign up, move and leave, runs the loot vote, and posts the vote result from a scheduled job.

**Architecture:** One signed HTTP endpoint (`api/discord.ts`) routes Discord interactions to handlers that work on Supabase Postgres and answer by returning the interaction response, or by calling Discord's REST API. Domain rules are pure functions. A second endpoint (`api/cron.ts`) runs scheduled jobs when GitHub Actions calls it. Everything is written to use only Node built-ins plus one database client.

**Tech Stack:** TypeScript run directly by Node 24 (type stripping, no build step), `node:test`, `node:crypto`, `fetch`, the `postgres` package, Docker for every tool and the test database.

**Spec:** [PRODUCT.md](../../PRODUCT.md) (requirements FR/NFR, checks CHK-001 to CHK-007) and the ADRs in [docs/decisions/](../decisions/). Milestones in [milestones.md](milestones.md).

## Global Constraints

- **Nothing is installed on the host.** All `npm`, `node`, script and test commands run in Docker (`docker compose run --rm node ...`). No package is added without the owner's approval. Approved so far: none. Proposed: `postgres` (runtime) and `typescript` plus `@types/node` (dev, type-check only).
- Source is TypeScript with erasable syntax only (no `enum`, `namespace`, constructor parameter properties) and imports with explicit `.ts` extensions, so Node 24 runs it unchanged.
- HTTP-only bot, no gateway (ADR 0001). Every request signature-verified before the body is parsed (NFR-001).
- Every interaction answered within 3 seconds, so all work happens before the response and no background work is relied on (NFR-002).
- Every table has `guild_id`; times stored as UTC `timestamptz` (NFR-004). Row-level security on every table; the anon and authenticated roles have no privileges (NFR-001).
- Queries are parameterized only. Secrets only in environment variables. Every bot message sets `allowed_mentions: { parse: [] }` (FR-018).
- Domain code (`src/domain/`) imports nothing from Discord or the database (NFR-007).
- Input limits (plan values, for owner review): title 1 to 100 characters, notes up to 500, role up to 30, weapon up to 40, slots 1 to 20.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Commits are made only when the owner has allowed them for the session.
- Environment variables: `DISCORD_PUBLIC_KEY`, `DISCORD_APP_ID`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `CRON_SECRET`; tests use `TEST_DATABASE_URL`.

## Review Focus

1. A forged `custom_id` pointing at another content, or at a slot of another content or guild: rejected, no state change (Tasks 11, 13).
2. Titles, notes and slot text containing `@everyone`, `<@id>`, markdown or maximum-length text: escaped, no ping, message under Discord limits (Task 6).
3. Malformed or impossible start times (`2026-02-30 18:00`, `25:00`, past, no zero padding): rejected with an example (Task 5).
4. Leave or vote by someone not signed up, a waitlisted user, or on cancelled content: private message, no state change (Tasks 10, 12).
5. The same interaction delivered twice, and a vote at exactly start minus 5 minutes: second delivery changes nothing, the boundary counts as closed (Tasks 10, 12).

## Owner prerequisites (task T1, done by the owner, not code)

- [ ] **Discord:** Developer Portal, new application. Note the Application ID and Public Key. Bot tab: reset and copy the token, leave privileged intents off. Install the bot with scopes `bot` and `applications.commands` and permissions View Channels, Send Messages, Send Messages in Threads, Embed Links, Read Message History. Turn on Developer Mode, create (or pick) one PvP forum and one PvE forum the bot can see, and copy the guild ID and both forum channel IDs.
- [ ] **Supabase:** new free project. Note the Project URL, the anon key, and the **Transaction pooler** connection string (port 6543) as `DATABASE_URL`. In the project's API settings, note whether the Data API can be switched off (open question Q6).
- [ ] **GitHub and Vercel:** a public GitHub repository for `bots/`, a Vercel Hobby account connected to it.
- [ ] **Local `.env`** (gitignored) with the variables above, and a `CRON_SECRET` made with `openssl rand -hex 32`.

## File Structure

```
api/discord.ts            thin wrapper: env, handleDiscordRequest
api/cron.ts               thin wrapper: secret check, runJobs
src/http/discord-handler.ts   signature check, PING, dispatch, logging
src/discord/{types,response,rest,dispatch,commands}.ts
src/domain/{types,parse,forum,vote}.ts
src/render/roster.ts
src/db/{client,migrate,content,settings,signup,vote}.ts
src/handlers/{create,signup,vote}.ts
src/jobs/cron.ts
supabase/migrations/0001_core.sql
scripts/{migrate,check-anon,register-commands,seed-guild}.ts
tests/**                  mirrors src/
.github/workflows/cron.yml
docker-compose.yml  package.json  tsconfig.json  .env.example  .gitignore
```

---

## M0: Foundation

### Task 1: Project scaffold with Docker tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `docker-compose.yml`, `.gitignore`, `.env.example`, `tests/smoke.test.ts`

**Interfaces:**
- Produces: `npm test` (runs `node --test --test-concurrency=1 "tests/**/*.test.ts"`), `npm run typecheck` (`tsc --noEmit`), compose services `node` (image `node:24`, repo mounted at `/app`, runs as the host user, reads `.env`, depends on `db`) and `db` (image `postgres:16`, database `postgres`, password `test`, host port 54329, `TEST_DATABASE_URL=postgres://postgres:test@db:5432/postgres` set on `node`).

- [ ] **Step 1: Write `tests/smoke.test.ts`** asserting `1 + 1 === 2` with `node:test`.
- [ ] **Step 2: Create the files.** `package.json` has `"type": "module"`, `engines.node` `24.x`, and no dependencies yet. `tsconfig.json` sets `noEmit`, `strict`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `module` and `moduleResolution` `nodenext`, `target` `es2023`. `.gitignore` covers `node_modules`, `.env`, `.vercel`. `.env.example` lists every variable above with empty values.
- [ ] **Step 3: Run** `docker compose run --rm node npm test`. Expected: 1 test passes.
- [ ] **Step 4: Ask the owner to approve the dependency list**, then run `docker compose run --rm node npm install postgres` and `docker compose run --rm node npm install -D typescript @types/node`. Run `docker compose run --rm node npm run typecheck`. Expected: no errors.
- [ ] **Step 5: Commit** `package.json package-lock.json tsconfig.json docker-compose.yml .gitignore .env.example tests/smoke.test.ts`.

### Task 2: Signed endpoint (CHK-001, local part)

**Files:**
- Create: `src/http/discord-handler.ts`, `src/discord/types.ts`, `src/discord/response.ts`, `api/discord.ts`
- Test: `tests/http/discord-handler.test.ts`

**Interfaces:**
- Produces:
  - `verifySignature(rawBody: string, signatureHex: string, timestamp: string, publicKeyHex: string): boolean` and `isFresh(timestamp: string, now: Date, windowSeconds?: number): boolean` (default 300) in `src/http/discord-handler.ts`.
  - `handleDiscordRequest(req: Request, opts: { publicKey: string; dispatch: Dispatch; now?: () => Date }): Promise<Response>`.
  - `type Dispatch = (i: Interaction) => Promise<InteractionResponse>` in `src/discord/types.ts`, with `Interaction` holding `id`, `type`, `application_id`, `token`, `guild_id?`, `channel_id?`, `channel?: { id; type; parent_id? }`, `member?: { user: { id }; permissions?: string; roles: string[] }`, `data?`; `InteractionResponse = { type: number; data?: unknown }`.
  - `reply(content: string): InteractionResponse` (type 4, flags 64) and constants `PONG`, `CHANNEL_MESSAGE`, `UPDATE_MESSAGE`, `MODAL`, `EPHEMERAL` in `src/discord/response.ts`.

- [ ] **Step 1: Write tests** (generate an Ed25519 key pair with `node:crypto` in the test, sign `timestamp + body`):
  - valid signature, fresh timestamp, `{"type":1}` returns 200 and `{"type":1}`.
  - body altered after signing returns 401 and `dispatch` is never called.
  - signature from a different key returns 401.
  - missing signature or timestamp headers returns 401.
  - timestamp older than 300 seconds returns 401.
  - a non-JSON body with a valid signature returns 400, and a bad signature with a non-JSON body returns 401 (signature is checked first).
  - a valid type-2 interaction returns the `dispatch` result as JSON with 200.
- [ ] **Step 2: Run** `docker compose run --rm node npm test`. Expected: the new tests fail (module missing).
- [ ] **Step 3: Implement `verifySignature`** with `crypto.verify(null, data, publicKey, signature)`; build the public key as an SPKI DER by prefixing the 32 raw key bytes with hex `302a300506032b6570032100`; return `false` for any parse error. Implement `handleDiscordRequest` to read `request.text()`, check headers, signature and freshness before `JSON.parse`, answer type 1 with `{type:1}`, and otherwise return `dispatch`'s JSON. It logs one line `{"evt":"interaction","type":<n>,"ms":<n>}` per accepted request, never the body or tokens.
- [ ] **Step 4: Implement `api/discord.ts`** as `export async function POST(request: Request)` calling `handleDiscordRequest` with `process.env.DISCORD_PUBLIC_KEY` and a `dispatch` that answers `reply("Not implemented yet")`. If Vercel's runtime rejects the web-standard export or `.ts` import specifiers at deploy (Task 4), stop and ask the owner before adding a bundler.
- [ ] **Step 5: Run tests.** Expected: all pass.
- [ ] **Step 6: Commit** `src api tests`.

### Task 3: Database schema, migration runner, locked-down access (CHK-006, local part)

**Files:**
- Create: `supabase/migrations/0001_core.sql`, `src/db/client.ts`, `src/db/migrate.ts`, `scripts/migrate.ts`, `scripts/check-anon.ts`, `tests/helpers/db.ts`
- Test: `tests/db/migrate.test.ts`

**Interfaces:**
- Produces:
  - `getSql(url?: string): Sql` in `src/db/client.ts` (the `postgres` package; `prepare: false` so it works with Supabase's transaction pooler; cached per URL; `max: 5`).
  - `applyMigrations(sql: Sql, dir: string): Promise<string[]>` (applies unapplied `*.sql` files in name order inside transactions, records them in table `schema_migrations(name text primary key, applied_at timestamptz)`, returns the names applied).
  - `testSql(): Promise<Sql>` and `resetDb(sql: Sql): Promise<void>` in `tests/helpers/db.ts` (connects to `TEST_DATABASE_URL`, applies migrations once, truncates all app tables with `restart identity cascade`). Later DB tests import these.

Schema in `0001_core.sql` (every table has `guild_id text not null`):

| Table | Columns and constraints |
|---|---|
| `guild_settings` | `guild_id` pk, `officer_role_id`, `pvp_forum_id not null`, `pve_forum_id not null`, `daily_cap int default 5`, `created_at` |
| `content` | `id uuid pk default gen_random_uuid()`, `thread_id not null`, `message_id`, `type check in ('pvp','pve')`, `title`, `notes`, `starts_at timestamptz`, `min_tier`, `min_enchant`, `max_tier`, `max_enchant` (smallints, max pair nullable), `has_loot bool`, `status check in ('open','locked','cancelled','done') default 'open'`, `loot_result_posted_at`, `created_by`, `created_at` |
| `slot` | `id uuid pk`, `content_id` fk cascade, `position smallint`, `role`, `weapon`, `unique (content_id, position)` |
| `signup` | `content_id` fk cascade, `user_id`, `slot_id` fk, `status check in ('signed','waitlist') default 'signed'`, `joined_at`, `primary key (content_id, user_id)`, plus `create unique index signup_one_signed_per_slot on signup (slot_id) where status = 'signed'` |
| `vote` | `content_id` fk cascade, `user_id`, `choice check in ('split','regear')`, `voted_at`, `primary key (content_id, user_id)` |

Each table also gets `alter table ... enable row level security;` and `revoke all on ... from anon, authenticated;`.

- [ ] **Step 1: Write `tests/db/migrate.test.ts`:** `applyMigrations` on an empty database creates all five tables; a second call returns `[]`; inserting two `signed` signups for one slot throws SQLSTATE `23505`; a `waitlist` row for an occupied slot succeeds; every app table reports `relrowsecurity = true` in `pg_class`.
- [ ] **Step 2: Run** `docker compose run --rm node npm test`. Expected: FAIL.
- [ ] **Step 3: Write the migration, `getSql`, `applyMigrations` and the test helper.** `scripts/migrate.ts` applies migrations to `DATABASE_URL`. `scripts/check-anon.ts` requests `${SUPABASE_URL}/rest/v1/content?select=*` with the anon key and exits non-zero unless the status is 401, 403 or 404.
- [ ] **Step 4: Run tests.** Expected: pass.
- [ ] **Step 5: Commit.**

### Task 4: Deploy and verify (CHK-001, CHK-006)

**Files:** none new (updates `PRODUCT.md`, `docs/plan/milestones.md`, `docs/open-questions.md`)

- [ ] **Step 1: Run migrations on Supabase:** `docker compose run --rm node npm run migrate`. Expected: prints `0001_core.sql`.
- [ ] **Step 2: Run** `docker compose run --rm node node scripts/check-anon.ts`. Expected: exit 0, status 401, 403 or 404. Record under CHK-006. Note the Data API answer for Q6.
- [ ] **Step 3: Push the repo to GitHub, import it in Vercel, add the environment variables from `.env`.** Deploy.
- [ ] **Step 4: In the Discord portal, save `https://<app>.vercel.app/api/discord` as the Interactions Endpoint URL.** Expected: Discord accepts it. Record under CHK-001 together with a `curl -i -X POST <url> -d '{}'` that returns 401.
- [ ] **Step 5: Update `PRODUCT.md` (CHK results, Current state), `milestones.md` (M0 done), `open-questions.md` (Q6), and commit.**

---

## M1: Create content in a forum post

### Task 5: Input parsers

**Files:**
- Create: `src/domain/types.ts`, `src/domain/parse.ts`
- Test: `tests/domain/parse.test.ts`

**Interfaces:**
- Produces: `type Result<T> = { ok: true; value: T } | { ok: false; error: string }`; `Tier = { tier: number; enchant: number }`; `TierRange = { min: Tier; max: Tier | null }`; `SlotDef = { role: string; weapon: string }`; and in `parse.ts`: `parseTier(input: string): Result<TierRange>`, `formatTier(r: TierRange): string`, `parseSlots(input: string): Result<SlotDef[]>`, `parseUtcStart(input: string, now: Date): Result<Date>`, `parseTitle(input: string): Result<string>`, `parseNotes(input: string): Result<string | null>`.

- [ ] **Step 1: Write the failing tests:**
  - `parseTier('T5.3')` is `{min:{tier:5,enchant:3},max:null}`; `'t5.3'` is accepted; `'T5.3-T7.0'`, `'T5.3 - T7.0'` and `'T5.3–T7.0'` give `max {7,0}`; `'T7.0-T5.3'`, `'T9.0'`, `'T5.5'`, `'5.3'`, `'T5'` and `''` are errors whose message contains `T5.3`.
  - `formatTier` gives `'T5.3'` and `'T5.3–T7.0'` (en dash).
  - `parseSlots('Tank - Axe\nDPS-Longbow\n\nHealer – Holy')` is three slots `{Tank,Axe}`, `{DPS,Longbow}`, `{Healer,Holy}`; a line without a separator errors naming `line 2`; 21 lines errors; empty input errors; a role over 30 or weapon over 40 characters errors; the weapon may contain spaces (`Tank - Great Axe`).
  - `parseUtcStart('2026-10-07 18:00', now)` with `now = 2026-10-06T12:00:00Z` is `2026-10-07T18:00:00.000Z`; a trailing ` UTC` is accepted; `'2026-02-30 18:00'`, `'2026-10-07 25:00'`, `'2026-10-7 18:00'`, `'2026-10-05 18:00'` (past) and `'2026-10-06 12:00'` (equal to now) are errors that include the example `2026-10-07 18:00`.
  - `parseTitle` trims, rejects empty and over 100; `parseNotes` returns `null` for empty or whitespace and errors over 500.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Tier is 1 to 8, enchant 0 to 4; split slots on the first hyphen or en dash. Build the date with `Date.UTC` and reject it unless the components round-trip.
- [ ] **Step 4: Run tests.** Expected: pass.
- [ ] **Step 5: Commit.**

### Task 6: Roster message renderer

**Files:**
- Create: `src/render/roster.ts`
- Modify: `src/domain/types.ts` (add `ContentType`, `ContentStatus`, `RosterSlot`, `RosterView`)
- Test: `tests/render/roster.test.ts`

**Interfaces:**
- Consumes: `TierRange`, `formatTier`.
- Produces: `RosterView = { id: string; guildId: string; threadId: string; messageId: string | null; type: 'pvp'|'pve'; title: string; notes: string | null; startsAt: Date; tier: TierRange; hasLoot: boolean; status: 'open'|'locked'|'cancelled'|'done'; slots: RosterSlot[]; votes: { split: number; regear: number }; voteClosed: boolean; voteResult: 'split'|'regear'|'tie'|'none'|null }`, `RosterSlot = { id: string; position: number; role: string; weapon: string; userId: string | null }`; `formatUtc(d: Date): string`; `escapeText(s: string): string`; `renderRosterMessage(view: RosterView): { embeds: Embed[]; components: unknown[]; allowed_mentions: { parse: [] } }`.

- [ ] **Step 1: Write the failing tests** with a view starting `2026-10-07T18:00:00Z`, tier `T5.3` to `T7.0`, type pvp, loot, slots `Tank - Axe` (user `111`) and `Healer - Holy` (open):
  - `formatUtc` gives `Wed 7 Oct 2026, 18:00 UTC`.
  - the embed description contains `Wed 7 Oct 2026, 18:00 UTC`, `<t:1791396000:F>`, `<t:1791396000:R>`, `T5.3–T7.0`, `PvP`, `Loot: Yes`, `1. Tank - Axe · <@111>`, `2. Healer - Holy · open`, and `Roster (1/2)`.
  - a view with no loot shows `Loot: No`; a single tier shows `T5.3` only.
  - a title of `@everyone **x**` renders with the markdown escaped and the `@` followed by a zero-width space; `allowed_mentions` is `{ parse: [] }`.
  - a view with 20 slots of maximum-length role and weapon keeps the description under 4096 characters.
  - `components` is `[]` for now.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `formatUtc` is built from UTC getters, with fixed English day and month names, no `Intl`. `escapeText` escapes `\ * _ ~ ` | > #` with a backslash and inserts a zero-width space after `@`.
- [ ] **Step 4: Run tests.** Expected: pass.
- [ ] **Step 5: Commit.**

### Task 7: Content persistence and guild settings

**Files:**
- Create: `src/db/content.ts`, `src/db/settings.ts`, `src/domain/forum.ts`
- Test: `tests/db/content.test.ts`, `tests/domain/forum.test.ts`

**Interfaces:**
- Consumes: `testSql`, `resetDb`, `RosterView`.
- Produces:
  - `NewContent = { guildId: string; threadId: string; type: ContentType; title: string; notes: string | null; startsAt: Date; tier: TierRange; hasLoot: boolean; createdBy: string; slots: SlotDef[] }`.
  - `createContent(sql: Sql, input: NewContent): Promise<string>` (one transaction; returns the content id), `setMessageId(sql: Sql, contentId: string, messageId: string): Promise<void>`, `deleteContent(sql: Sql, contentId: string): Promise<void>`, `getRosterView(sql: Sql, contentId: string, now: Date): Promise<RosterView | null>` (slots ordered by position with the signed user, vote counts and `voteClosed`/`voteResult` left at `{0,0}`, `false`, `null` until Task 12).
  - `GuildSettings = { guildId: string; officerRoleId: string | null; pvpForumId: string; pveForumId: string; dailyCap: number }`; `getGuildSettings(sql: Sql, guildId: string): Promise<GuildSettings | null>`; `forumContentType(s: GuildSettings, parentId: string | null): 'pvp' | 'pve' | null` in `src/domain/forum.ts`.

- [ ] **Step 1: Write the failing tests:**
  - `createContent` with three slots stores positions 1 to 3 in input order; `getRosterView` returns them with `userId: null`, the tier, `startsAt` and `status: 'open'`; unknown id returns `null`.
  - `deleteContent` removes the content and its slots.
  - `getGuildSettings` returns `null` for an unknown guild and the row after an insert.
  - `forumContentType` returns `'pvp'` for the PvP forum id, `'pve'` for the PvE id, `null` for any other id and for `null`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** with parameterized queries only; map tier columns to `TierRange` (max `null` when its columns are null).
- [ ] **Step 4: Run tests.** Expected: pass.
- [ ] **Step 5: Commit.**

### Task 8: `/content create` flow

**Files:**
- Create: `src/discord/rest.ts`, `src/discord/dispatch.ts`, `src/discord/commands.ts`, `src/handlers/create.ts`, `scripts/register-commands.ts`, `scripts/seed-guild.ts`
- Modify: `api/discord.ts` (wire real dispatch)
- Test: `tests/handlers/create.test.ts`, `tests/discord/rest.test.ts`

**Interfaces:**
- Consumes: parsers, `renderRosterMessage`, `createContent`, `setMessageId`, `deleteContent`, `getRosterView`, `getGuildSettings`, `forumContentType`, `reply`.
- Produces:
  - `Rest = { createMessage(channelId: string, body: unknown): Promise<{ id: string }>; editMessage(channelId: string, messageId: string, body: unknown): Promise<void> }`; `createRest(token: string, fetchFn?: typeof fetch): Rest` (`Authorization: Bot <token>`, retry once after `retry_after` on HTTP 429, throws `DiscordApiError` with `status` otherwise).
  - `Deps = { sql: Sql; rest: Rest; now: () => Date }`; `createDispatch(deps: Deps): Dispatch` routing by interaction type and `custom_id` prefix.
  - `handleCreateCommand(deps: Deps, i: Interaction): Promise<InteractionResponse>` and `handleCreateModal(deps: Deps, i: Interaction): Promise<InteractionResponse>`.
  - Command: `/content create` with boolean option `loot`. Modal custom id `create:1` or `create:0`, five text inputs with ids `title`, `start` (placeholder `2026-10-07 18:00`), `tier` (placeholder `T5.3 or T5.3-T7.0`), `slots` (paragraph, placeholder `Tank - Axe`), `notes` (optional).

- [ ] **Step 1: Write the failing tests** (real test database, fake `Rest` recording calls):
  - the command run in a channel whose `parent_id` is not a configured forum, or with no `guild_id`, returns an ephemeral reply containing `forum`.
  - the command run in a thread whose parent is the PvP forum, with `loot: true`, returns type 9 with custom id `create:1` and the five input ids; `loot: false` or missing gives `create:0`.
  - a valid modal submit creates a content row of type `pvp` with the creator id from `member.user.id`, the slots in order and `has_loot` true, calls `createMessage` once with the thread id and a body that includes `allowed_mentions: { parse: [] }`, stores the returned id with `setMessageId`, and responds ephemeral `Created`.
  - the modal submit re-checks the forum from the interaction (a submit from a non-forum channel creates nothing).
  - an invalid tier, impossible date, past date, 21 slots or oversized title responds ephemeral with the parser's message and creates no row.
  - when `createMessage` throws, the content row is deleted and the response is an ephemeral error without secrets.
  - `createRest` with a fake `fetch` returning 429 with `retry_after: 0` then 200 succeeds on the retry, and returns `{ id }`; a 500 throws `DiscordApiError` with `status` 500.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement the handlers.** Modal submit reads values from `data.components[n].components[0]`. Unknown commands and unknown `custom_id` prefixes answer `reply("Not implemented yet")`. Nothing is written to Discord before the DB row exists; a failed message post removes the row.
- [ ] **Step 4: Implement `scripts/register-commands.ts`** (PUT to `/applications/{DISCORD_APP_ID}/guilds/{DISCORD_GUILD_ID}/commands` with `src/discord/commands.ts`) and `scripts/seed-guild.ts <guildId> <pvpForumId> <pveForumId>` (upsert into `guild_settings`).
- [ ] **Step 5: Run tests.** Expected: pass.
- [ ] **Step 6: Commit.**

### Task 9: Live check, M1 (CHK-002, CHK-004)

- [ ] **Step 1: Deploy** (push to `main`). Run `docker compose run --rm node node scripts/register-commands.ts`, then `... node scripts/seed-guild.ts <guildId> <pvpForumId> <pveForumId>` against Supabase.
- [ ] **Step 2: In a PvP forum post, run `/content create loot:true` and fill the modal.** Expected: a roster message appears in the post with the UTC text, a local time and a relative time.
- [ ] **Step 3: Have a second member in a different timezone confirm the local time reads correctly,** or change the Discord client's timezone and compare. Record under CHK-002.
- [ ] **Step 4: Wait 30 minutes idle, then run the command again.** Read the Vercel logs line `{"evt":"interaction",...,"ms":N}` and record `N` and pass or fail (under 3000) under CHK-004.
- [ ] **Step 5: Update `PRODUCT.md`, `milestones.md`, `open-questions.md` (Q7: result of posting inside a forum thread), commit.**

---

## M2: Sign up, move, leave

### Task 10: Signup persistence with atomic claim

**Files:**
- Create: `src/db/signup.ts`
- Modify: `src/db/content.ts` (`getRosterView` already returns the signed user)
- Test: `tests/db/signup.test.ts`

**Interfaces:**
- Produces: `claimSlot(sql: Sql, a: { contentId: string; slotId: string; userId: string; guildId: string }): Promise<'claimed' | 'moved' | 'unchanged' | 'taken' | 'locked' | 'not_found'>` and `leaveContent(sql: Sql, a: { contentId: string; userId: string }): Promise<'left' | 'not_signed' | 'unavailable'>`.

- [ ] **Step 1: Write the failing tests** (real database):
  - claiming an open slot returns `'claimed'` and the roster shows the user.
  - the same user claiming a different slot returns `'moved'` and the old slot is open.
  - the same user claiming the same slot again returns `'unchanged'` and changes nothing (a double delivery).
  - another user claiming a taken slot returns `'taken'` and the holder is unchanged.
  - a slot of another content, or a `guildId` that differs from the content's, returns `'not_found'`.
  - content with status `locked` returns `'locked'` for a claim.
  - race: 25 trials, each running two claims for different users on the same fresh slot with `Promise.all`; every trial yields exactly one `'claimed'` and one `'taken'`.
  - `leaveContent` returns `'left'` and frees the slot; a second call returns `'not_signed'`; leaving a `locked` content returns `'left'`; leaving a `cancelled` content returns `'unavailable'`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement `claimSlot` in one transaction:** read the content (status, guild) and the slot, read the user's existing signup `for update`, then upsert on `(content_id, user_id)`; map a `23505` on `signup_one_signed_per_slot` to `'taken'`.
- [ ] **Step 4: Run tests.** Expected: pass, including the race.
- [ ] **Step 5: Commit.**

### Task 11: Signup menu and Leave button

**Files:**
- Create: `src/handlers/signup.ts`
- Modify: `src/render/roster.ts` (components), `src/discord/dispatch.ts` (routes `signup:` and `leave:`)
- Test: `tests/render/roster.test.ts` (extend), `tests/handlers/signup.test.ts`

**Interfaces:**
- Consumes: `claimSlot`, `leaveContent`, `getRosterView`, `renderRosterMessage`.
- Produces: `handleSignup(deps: Deps, i: Interaction): Promise<InteractionResponse>` for custom id `signup:<contentId>` (select, `data.values[0]` is the slot id) and `handleLeave(deps: Deps, i: Interaction): Promise<InteractionResponse>` for `leave:<contentId>`. Roster components: a row with a string select (type 3, custom id `signup:<contentId>`, placeholder `Pick a position`, one option per slot with label `<n>. <role> - <weapon>` truncated to 100 characters, value the slot id, description `Open` or `Taken`) and a row with a button (type 2, style 2, label `Leave`, custom id `leave:<contentId>`). The select is disabled unless status is `open`; the button is disabled when status is `cancelled` or `done`.

- [ ] **Step 1: Write the failing tests:**
  - render: a view with two slots has an action row with the select and the Leave button; options carry slot ids and `Taken` for an occupied slot; a `locked` view has the select disabled and Leave enabled.
  - handler: a valid selection returns type 7 whose body shows the user on the slot; an already taken slot returns an ephemeral message containing `taken` and no change; a slot id from another content returns an ephemeral error and no change; an interaction whose `guild_id` differs from the content's returns an ephemeral error; selecting on locked content returns an ephemeral message containing `locked`; Leave when signed returns type 7 with the slot open; Leave when not signed returns an ephemeral message and no change; the user id comes only from `member.user.id`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** After a successful change, reload the roster with `getRosterView` and respond with `renderRosterMessage`.
- [ ] **Step 4: Run tests.** Expected: pass.
- [ ] **Step 5: Commit, deploy, then do the live check:** in the guild, sign up, move to another slot and leave; confirm the roster updates each time. Record under CHK-003 together with the automated 25-trial race result (two simultaneous human clicks are not reliably reproducible by hand). Update `PRODUCT.md`, `milestones.md`, commit.

---

## M3: Loot vote and scheduled job

### Task 12: Vote rules and persistence

**Files:**
- Create: `src/domain/vote.ts`, `src/db/vote.ts`
- Modify: `src/db/content.ts` (`getRosterView` fills `votes`, `voteClosed`, `voteResult`)
- Test: `tests/domain/vote.test.ts`, `tests/db/vote.test.ts`

**Interfaces:**
- Produces:
  - `VOTE_CUTOFF_MS = 300000`; `isVoteOpen(startsAt: Date, now: Date): boolean` (true only while `now < startsAt - 5 minutes`); `tallyVotes(choices: ('split' | 'regear')[]): { split: number; regear: number; result: 'split' | 'regear' | 'tie' | 'none' }`.
  - `castVote(sql: Sql, a: { contentId: string; userId: string; guildId: string; choice: 'split' | 'regear'; now: Date }): Promise<'recorded' | 'changed' | 'closed' | 'not_signed' | 'no_loot' | 'unavailable' | 'not_found'>`.
  - In `RosterView`: `voteClosed = !isVoteOpen(startsAt, now)`; `voteResult` is the tally result when `voteClosed` and `hasLoot`, otherwise `null`.

- [ ] **Step 1: Write the failing tests:**
  - `isVoteOpen` is true at start minus 5:01, false at exactly start minus 5:00, false after.
  - `tallyVotes`: three split and two regear gives result `split`; two and two gives `tie`; none gives `none`.
  - `castVote` records a vote for a signed user and returns `'recorded'`; the same user choosing the other option returns `'changed'` and the count is not doubled; a waitlisted user or a user who is not signed up returns `'not_signed'`; content without loot returns `'no_loot'`; a vote at exactly start minus 5:00 returns `'closed'` and stores nothing; cancelled content returns `'unavailable'`; a `guildId` mismatch returns `'not_found'`; voting while the content is `locked` and before the cutoff is accepted.
  - `getRosterView` counts votes, and shows `voteResult: 'tie'` after the cutoff with 1 and 1.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** (upsert on `(content_id, user_id)`; decide `recorded` or `changed` from the previous row).
- [ ] **Step 4: Run tests.** Expected: pass.
- [ ] **Step 5: Commit.**

### Task 13: Vote buttons and result display

**Files:**
- Create: `src/handlers/vote.ts`
- Modify: `src/render/roster.ts`, `src/discord/dispatch.ts` (route `vote:`)
- Test: `tests/render/roster.test.ts` (extend), `tests/handlers/vote.test.ts`

**Interfaces:**
- Consumes: `castVote`, `getRosterView`, `renderRosterMessage`.
- Produces: `handleVote(deps: Deps, i: Interaction): Promise<InteractionResponse>` for custom id `vote:<contentId>:<split|regear>`. When `hasLoot`, the roster has a button row `Split (n)` (style 1, id `vote:<id>:split`) and `Regear (n)` (style 3, id `vote:<id>:regear`), both disabled when `voteClosed` or status is `cancelled` or `done`. The description gains a line `Loot vote: Split 3 - Regear 2` while open, and after the cutoff `Loot vote result: Split won 3-2`, `Loot vote result: Tie 2-2` or `Loot vote result: no votes`. No voter names appear anywhere.

- [ ] **Step 1: Write the failing tests:**
  - render: loot view with votes `{3,2}` shows `Split (3)` and `Regear (2)` enabled; after the cutoff the buttons are disabled and the description contains `Split won 3-2`; a view with a tie shows `Tie 2-2`; a no-loot view has no vote row.
  - handler: a signed user clicking `Split` gets type 7 with the updated count; clicking after the cutoff gets an ephemeral message containing `closed`; a non-signed user gets an ephemeral message containing `signed up`; a forged choice (`vote:<id>:other`) or an unknown content id gets an ephemeral error; a `guild_id` mismatch changes nothing.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.** Expected: pass.
- [ ] **Step 5: Commit.**

### Task 14: Cron route, jobs, GitHub Actions (CHK-005, CHK-007)

**Files:**
- Create: `src/jobs/cron.ts`, `api/cron.ts`, `.github/workflows/cron.yml`
- Test: `tests/jobs/cron.test.ts`

**Interfaces:**
- Consumes: `Rest`, `getRosterView`, `renderRosterMessage`, `tallyVotes`.
- Produces: `isAuthorized(header: string | null, secret: string): boolean` (accepts only `Bearer <secret>`, constant-time, false for empty secrets); `lockStarted(deps: Deps): Promise<number>` (sets `open` content with `starts_at <= now` to `locked`, re-renders the roster message, returns the count); `postVoteResults(deps: Deps): Promise<number>` (for content with loot, status `open` or `locked`, `starts_at - 5 minutes <= now` and `loot_result_posted_at is null`: edits the roster, posts `Loot vote result: ...` in the thread, then sets `loot_result_posted_at`); `runJobs(deps: Deps): Promise<{ locked: number; resultsPosted: number }>`. A Discord 404 on the roster edit counts as handled and is logged; any other Discord error leaves `loot_result_posted_at` empty so the next run retries.

- [ ] **Step 1: Write the failing tests** (real database, fake `Rest`):
  - `isAuthorized`: correct bearer true; wrong secret, no header, `Bearer ` with nothing, a different scheme, and an empty configured secret are all false.
  - `lockStarted` locks only open content whose start has passed, edits that roster once, and a second run returns 0.
  - `postVoteResults` does nothing before start minus 5 minutes, posts exactly one edit and one thread message at or after it, marks the content, and a second run returns 0.
  - the edited roster body contains the result line; a fake `Rest` that throws `DiscordApiError` status 500 leaves the content unmarked and a later run with a working `Rest` posts it; status 404 on the edit still posts the thread message and marks it.
  - content without loot is never touched by `postVoteResults`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement the jobs and `api/cron.ts`** as `export async function GET(request: Request)` and `POST`, answering 401 without the secret, otherwise JSON `{ locked, resultsPosted }`. Add `.github/workflows/cron.yml` with `schedule: cron "*/5 * * * *"` plus `workflow_dispatch`, one step running `curl --fail -X POST -H "Authorization: Bearer $CRON_SECRET" "$CRON_URL"` from repository secrets `CRON_URL` and `CRON_SECRET`.
- [ ] **Step 4: Run tests.** Expected: pass.
- [ ] **Step 5: Commit, deploy, add the two GitHub secrets, and trigger the workflow with `workflow_dispatch`.** Expected: success, response `{"locked":0,"resultsPosted":0}`.
- [ ] **Step 6: Live vote check.** Create loot content starting about 15 minutes ahead, sign up two accounts and vote. Confirm that a vote after start minus 5 minutes is refused. Record when the roster shows the result and the thread message time. The delay is that time minus (start minus 5 minutes); record it under CHK-005 along with whether it came before the start. Note today's date under CHK-007 and check the Supabase project again 7 days later.
- [ ] **Step 7: Update `PRODUCT.md` (all CHK results, Current state: POC validated or not), `milestones.md`, `tasks.md`, `open-questions.md` (Q1, Q5), `lessons.md`; commit.** Do not begin M4 until every non-dropped CHK is recorded as passing.
