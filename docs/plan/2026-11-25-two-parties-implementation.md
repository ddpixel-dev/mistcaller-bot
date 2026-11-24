# Two parties, Setup Slots and forums: implementation plan (release 0.33.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship FR-081 to FR-084 (ADR 0050) as release 0.33.0.

**Architecture:**
- Two-party normal content reuses the CTA's one-message roster. A single condition, `partyCount > 1 || cta`, replaces "is a CTA" wherever the code means "one message for all parties".
- Setup Slots keeps its builder as it is. The draft maps the builder's working slots to the chosen party's column.
- Forum routing goes through one function, `forumTypeFor(type)`.

**Tech Stack:** TypeScript on Node 24 with `node --test`, in Docker; Postgres 16.

**Spec:** [2026-11-25-two-parties-setup-slots-forums-design.md](2026-11-25-two-parties-setup-slots-forums-design.md)

**Branch:** `feature/two-parties-setup-slots`

## Global Constraints

- Write each test first. Domain logic stays pure. Custom ids of posted messages do not change.
- Every new or changed message passes `discordProblems` or `modalProblems`.

## Review Focus

1. A two-party normal roster in a forum post: one message, both parties' menus, and no Bombers line or button (Task 2).
2. Turning a two-party card back to one party drops party 2 (Task 1).
3. Setup Slots on party 2 leaves party 1 untouched, and the reverse (Task 4).
4. A ZvZ or PvX event when only the PvP forum is set: it is created there (Task 3).
5. Editing a two-party normal content: Edit party 2 slots works and Edit details holds party 1 (Task 2).

---

### Task 1: The parties rule and the card (FR-081, FR-082)

**Files:** `src/domain/parties.ts`, `src/domain/card.ts`, `src/render/card.ts`, `src/handlers/card.ts`, `src/handlers/help.ts` and the render/guided title. Tests: `tests/domain/card.test.ts`, `tests/domain/parties.test.ts`, `tests/handlers/card.test.ts`.

- `maxPartiesFor(_kind, _isCta)` returns 2.
- `validateCard` treats a normal card with `parties: 2` like a CTA: both parties are needed, using the mode's parser and no CTA-only rules.
- The card shows the Parties menu on every card.
- Normal two-party cards get **Party 2 slots** and **Copy party 1**, and the Details box label reads "Party 1 slots".
- Create passes `slots2` to `publish`.
- The Roles button becomes **Setup Slots** (also in the tips and help), and the builder's heading becomes "Setup Slots".

- [ ] Tests:
  - Two-party normal validation.
  - The menu on a normal card.
  - Going back to one party drops party 2.
  - The button is named Setup Slots.
  - Create stores both parties.
- [ ] Implement, run all tests, commit.

### Task 2: One roster message for two-party normal content (FR-081)

**Files:** `src/handlers/rosters.ts` (`isOneMessage`), `src/render/roster.ts` (renderer condition), `src/handlers/create.ts` (no separate party 2 post), and any other `view.cta` check that means "one message". Tests: `tests/render/roster.test.ts`, `tests/handlers/card.test.ts` and `tests/handlers/manage.test.ts`.

- [ ] Tests:
  - A two-party normal view renders one message with Party 1 and Party 2 headings and two join menus, and no Bombers. `discordProblems` gives `[]`.
  - Create in a forum makes one post and one message.
  - Edit party 2 slots on normal content.
- [ ] Implement, run all tests, commit.

### Task 3: PvE forum, else PvP forum (FR-083)

**Files:** `src/domain/card.ts` (`forumTypeFor`, `pickEventForum`), `src/handlers/card.ts` (`destinationOf`), `src/discord/commands.ts` (`forum-type` choices), `src/handlers/setup.ts` (texts and validation). Tests: `tests/domain/card.test.ts`, `tests/handlers/card.test.ts`, `tests/handlers/setup.test.ts`, `tests/discord/commands-limits.test.ts`.

- [ ] Tests:
  - `forumTypeFor("zvz")` is `"pvp"` and `forumTypeFor("pve")` is `"pve"`.
  - A ZvZ card with only a PvP forum set is created in that forum.
  - `/content setup` refuses `forum-type pvx` and `zvz`.
- [ ] Implement, run all tests, commit.

### Task 4: Setup Slots asks which party (FR-084)

**Files:** `supabase/migrations/0037_guided_party.sql`, `src/db/draft.ts` (`guidedParty`, plus working slots mapped to the party's column in `getDraft` and `saveDraft`), `src/handlers/card.ts` (`cc:guided` asks, `cc:gp` chooses), `src/handlers/guided.ts` and `src/render/guided.ts` (Party 2 in the title, done saves to the party). Tests: `tests/db/draft.test.ts`, `tests/handlers/guided.test.ts`.

- [ ] Tests:
  - A two-party card's Setup Slots shows Party 1 and Party 2.
  - Party 2 builds and saves `slots2`, with `slots` unchanged.
  - Party 1 still saves `slots`.
  - A one-party card goes straight to the builder.
- [ ] Implement, run all tests, commit.

### Task 5: Docs and release 0.33.0

- [ ] Changelog `changelog/0.33.0.md`, `PRODUCT.md` statuses and current state, the handoff and the index.
- [ ] Full suite and typecheck. Merge to develop. Release: migrate 0037, merge to main, tag, push, deploy check, register the commands (after the command limits test), then dry-run and post the changelog.
