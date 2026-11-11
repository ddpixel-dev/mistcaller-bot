---
title: CTA pinned message and two parties design
type: plan
status: accepted (owner approved 2026-11-10; not built)
date: 2026-11-10
satisfies: [FR-069, FR-070]
---

# CTA pinned message (FR-069) and two parties (FR-070)

Two owner requests of 2026-11-10, designed together in one session. They touch the same code (CTA posting), so they share one document, but they are two features on two branches. The pinned message is built first.

## Guardrail check (docs/process/guardrails.md)

| ID | Verdict | Note |
|---|---|---|
| FR-059, ADR 0036 | consistent | A CTA is announced in the CTA channel with a thread whose first message is the roster. Both features extend this. |
| ADR 0037 | consistent | `cta-msg` follows the `cta-role` setup option pattern. |
| FR-063 | consistent | The roster is pinned; the new message is pinned after it. |
| ADR 0004, FR-003 | supersedes (in part) | A roster has at most 20 slots. A content with two parties has 20 per party, so 40 in all. 0004 stays true for each party. |
| ADR 0035, FR-057 | consistent | Fill and waitlist logic runs per party, unchanged inside a party. |
| NFR-001, FR-018 | constraint | The copied message is sent with mentions disabled. |
| NFR-005 | constraint | No state in memory; every render rebuilds from the database. |
| 0.32.0 ZvZ brief | overlap | Questions 2 to 4 of the brief are answered by this design for CTA; ZvZ reuses the model. |

Phase: MVP, unlocked. No new dependency (ADR 0006, NFR-003). One migration.

## Part 1: the pinned CTA message (FR-069)

> **Update 2026-11-10 (owner decision):** the bot **forwards** the source message instead of copying it, because without the privileged Message Content intent it cannot read another member's message. See the update in ADR 0045. Where this part says "copy", read "forward"; the attachment links, the 2000-character cut and the embed filtering are dropped.

### Goal
Every CTA carries a fixed server message (rules, reminders, links to other channels), set once by an admin and appended automatically. The owner does not attach it per CTA.

### What Discord allows
- There is no live reference or mirror of a message. A forward is a snapshot.
- The bot uses HTTP interactions and has no gateway, so it never receives edit events.
- Fetching a message needs the channel ID and the message ID, so the setting takes a **message link**.
- The source rarely changes (owner, 2026-11-10), so the copy is made at creation. Older CTAs keep the text they were made with.
- Channel mentions (`<#id>`) are plain text that render as links; they never ping and are not affected by `allowed_mentions`. They survive a verbatim copy.

### Behaviour
- `/content setup cta-msg:<message link>` sets it; `clear-cta-msg` removes it. Admins only. The setup panel shows the current link.
- On setting, the bot fetches the message. It refuses a link from another server and a message it cannot read, and the reply names the permissions to grant (View Channel and Read Message History on the source channel).
- When a CTA is created, in this order: the roster is posted in the thread and pinned (as now, FR-063); the bot reads the source message; it posts a copy as a **separate message** below the roster, and pins it. With two parties (Part 2) the copy comes after both rosters.
- Copied: the text and the embeds, sent with `allowed_mentions: { parse: [] }`. An attachment cannot be re-sent without uploading it again, so each attachment is added to the text as a link.
- Failures never block the CTA. If the source is deleted or unreadable, the copy is skipped; if the pin fails, the message stays unpinned. The creator gets a private note naming the skipped step. The bot needs **Pin Messages** in the CTA channel (a separate permission from Manage Messages); the setup reply lists it. A thread holds at most 50 pins.
- Not included: refreshing old CTAs when the source is edited. It can be added later by re-reading the source on roster updates.

### Design
- **Data:** table `cta_message (guild_id primary key, channel_id, message_id, updated_at)`, row level security on, like `cta_channel` (migration 0031).
- **DB:** `getCtaMessage`, `setCtaMessage`, `clearCtaMessage` in `src/db/cta.ts`.
- **Domain (pure):** `parseMessageLink(text, guildId)` returns channel and message IDs, or an error; `buildCtaCopy(source)` returns the text with attachment links, the embeds, and the `allowed_mentions` value. No Discord or database imports (NFR-007).
- **REST:** `getMessage(channelId, messageId)` and `pinMessage(channelId, messageId)` added to the REST wrapper in `src/discord/rest.ts`.
- **Setup handler:** `cta-msg` and `clear-cta-msg` options in `src/discord/commands.ts` and `src/handlers/setup.ts`, with descriptions under 100 characters (`tests/discord/commands-limits.test.ts` checks it). Commands must be registered again after release.
- **Posting:** the CTA posting code in `src/handlers/card.ts` (Create and Blank) calls a small function after the roster is posted.
- **Security:** the link's guild must equal the interaction's guild; the bot never follows an ID from a member; the secret and the message text are not logged.

### Tests
- Domain: the link parser (good link, other guild, malformed, thread links); the copy builder (text, embeds, attachment links, mentions disabled).
- Handler: setting and clearing, refusal of a bad link, non-admin refused.
- Posting with fakes: the order roster, copy, pin; a missing source; a failing pin; both still leave a created CTA and a private note.

## Part 2: two parties (FR-070)

### Goal
A CTA may have two parties, each up to 20 players (40 in all). The owner is trying this on CTA only; ZvZ (0.32.0 brief) will use the same model later.

### Decisions made in the session
1. The party count is a **choice at creation**: 1 (as today) or 2. Default 1.
2. **Two messages, one per party.** Each message is a complete roster with its own menu, buttons, fills and waitlist.
3. **Fill and waitlist are per party.** A fill or a waitlisted player waits for a seat in the party where they asked.
4. CTA positions are written as text. Each party has its own box, up to 20 lines. For CTA, **a role outside Tank, DTank, Healer, Support, DPS is rejected** with a clear error; the boxes show a hint of the supported roles. Normal content keeps accepting any role.
5. The party count is **fixed after creation**. To change it, cancel and create again.
6. It is built for CTA only, but through one pure function so that ZvZ changes one place.

### Data (migration 0032)
- `content.party_count smallint not null default 1 check (party_count in (1, 2))`. Existing content stays at 1.
- `slot`, the waitlist rows and the fill and applicant rows get `party smallint not null default 1`. A member holds one entry per content, and the entry records its party.
- Position numbering by role (ADR 0030) restarts inside each party. The unique key on `slot` becomes (content, party, position).
- **Plan refinement (2026-11-10, confirmed by the owner on 2026-11-10 by approving the plan):** the code audit found about 200 lookups by (content, position) in 20 files. To avoid touching them, `slot.position` stays unique per content (party 1's positions first, then party 2's, each sorted by role) and `slot.party` is added beside it. The **displayed** number restarts at 1 in each party, so nothing the owner sees changes. If the owner prefers the key above, the plan's Task B2 and the lookups listed in its audit table grow.
- `content_message (content_id, party, message_id, primary key (content_id, party))`, row level security on. Party 1 keeps the message ID the content already has, so no old roster changes. A second row exists only when `party_count` is 2.
- Never edit a migration after it ran on production.
- Risk to audit in the plan: code that identifies a position only by its number must also take the party. The plan lists every such place before any code is written.

### The extension hook
`maxPartiesFor(category, isCta)` in the domain returns 2 for a CTA and 1 otherwise. The creation card shows the Parties choice only when it returns more than 1. ZvZ later changes what it returns and adds its own party labels; the mechanism is the same.

### Messages
- The roster renderer takes a party. Party 1's message is the roster of today: title, time, tier, description, the shared buttons (Manage, Ping, loot vote) and its rows.
- Party 2's message is a smaller roster headed "Party 2": its own open-positions menu, Join, Leave, Tentative, Fill, waitlist and fills. Button IDs carry the party.
- Every change re-renders every party's message from the database. If one edit fails, the other still happens, the error is logged, and the next render or the scheduled job repairs it.
- In the CTA thread the order is party 1, party 2, then the Part 1 message. All are pinned in that order.
- Each message has its own 4000-character text budget and 40-component budget; a party of 20 fits Discord's 25-option menus.

### Creation (CTA)
- (Owner decision 2026-11-10, ADR 0036 update) The CTA card hides the Type and Category menus; a CTA is stored as PvX, category Other.
- The creation card gets a **Parties** choice (1 or 2).
- With 2 parties the Details box is labelled **Party 1 slots**. A **Party 2 slots** button opens a box of the same kind, and **Copy party 1** fills party 2 with party 1's lines.
- Each box takes up to 20 lines through the existing parser. Errors name the party and the line: `Party 2, line 3: "Heal" is not a supported role. Use Tank, DTank, Healer, Support or DPS.` Fix and retry keeps the typed text.
- Presets store the party count and both parties' lines. Presets saved earlier have party 1 only and are unchanged.
- Blank CTAs have no roster, so no parties.

### Player flows
- **Join or move:** a player picks from a party message's menu. If they hold an entry in either party, they are moved. One entry per content stays true. Both messages re-render.
- **Leave and Tentative** act on the entry in that party. If the player is in the other party, they get a private note saying which party.
- **Fill:** the panel on a party message offers Any and that party's roles. A fill is seated at once, healers first, when that party has a suitable open position, else it waits in that party (ADR 0035).
- **Waitlist:** a freed position promotes only from that party's waitlist.
- **Selection mode:** applicants apply on a party's message and are reviewed per party.

### Host flows (Manage is on party 1's message)
- **Assign, Add, Remove, Set weapon, Review applicants:** each starts with a **Party 1 / Party 2** choice, then runs the existing panel for that party. With one party the step is skipped.
- **Edit slots:** the same choice, then the Slots box with the CTA role check. The party count cannot be changed.
- **Attendance:** the form asks for the party first, then marks players as today, which stays under 25 options. Attendance and statistics count a player once across both parties (FR-014: unmarked is never a no-show).
- **Shared:** loot vote (one per content, on party 1's message), Ping (once per player across both parties), reminders, lock, cancel, end, reopen. Lock, cancel and end grey out every message.

### Calendar and lists
The party count shows the total, for example `31/40`. The Open link goes to party 1's message.

### Tests
- Domain (pure): `maxPartiesFor`; the CTA role check and its messages; the per-party parse; the one-entry-per-content move; per-party waitlist promotion and fill matching; numbering restarting per party.
- DB: the migration on the local test database; slots and waitlists keyed by party; `content_message` rows.
- Render: party 1 and party 2 messages, `discordProblems` limits, text budget with 20 rows per message.
- Handlers with fakes: join, move across parties, leave, tentative, fill, waitlist, the host party choice, forged party values refused, a CTA with two parties created end to end, posting order and pins.

## Not included
- Changing the party count after creation.
- Shared fill or waitlist across parties.
- Refreshing older CTAs when the pinned message source changes.
- ZvZ itself (types, categories, forums): the 0.32.0 brief, which now reuses this model.
- More than two parties.

## Branches and release
Two branches from `develop`: `feature/cta-message` first, then `feature/cta-parties`. Domain logic and tests first. The release follows the checklist in the 0.32.0 brief. The pinned-message release needs `scripts/register-commands.ts` and the Pin Messages permission for the bot in the CTA channel. The parties release needs production migrated before the code is deployed, because the roster query reads the new columns. Each release gets a `changelog/` entry in players' language with how-to steps (including the supported roles).

## Records
ADR 0044 (two parties) and ADR 0045 (pinned CTA message), FR-069 and FR-070 in `PRODUCT.md`, and the ZvZ brief updated. All were accepted with this document on 2026-11-10.
