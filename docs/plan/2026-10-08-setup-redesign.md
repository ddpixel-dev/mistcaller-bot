---
title: Setup redesign: any server, any channel, admin roles
type: plan
status: accepted
date: 2026-10-08
satisfies: [FR-002, FR-009, FR-010, FR-025]
---

# Setup redesign: any server, any channel, admin roles

Written for the owner's approval. Nothing here is built. Owner answers so far (2026-10-08): register commands globally (explained below), content may be created in any channel, admin roles manage any content and presets beside the content owner, anyone may create content, the daily cap is dropped, and there stays one content per post, thread or channel.

## 1. Server: no server id to configure
- **Today:** `scripts/register-commands.ts` sends the commands to one server named by `DISCORD_GUILD_ID`. Everything else already comes from the verified interaction, and every table is keyed by guild id.
- **Proposed:** register the commands **globally** (`PUT /applications/{app}/commands`). The commands then exist in every server the bot is in. `DISCORD_GUILD_ID` is no longer needed.
- Moving to a new server = invite the bot there (invite link with the `bot` and `applications.commands` scopes), give it the permissions it needs in the channels you use (View Channel, Send Messages, Embed or Use External Emoji), and the commands appear. The weapon icons are application emoji, so they work there with nothing to do.
- **One-time cleanup:** the commands already registered to your current server stay as duplicates until removed, so the register script clears that server's own list once (`PUT /applications/{app}/guilds/{guild}/commands` with `[]`) when `DISCORD_GUILD_ID` is still set.
- **Who can add the bot:** switch the application to private (Developer Portal, Bot, turn off "Public Bot") so only you can invite it.
- Cost to know: a global command change can take a short while to appear everywhere, unlike a server command.

## 2. Any channel, one content per post, thread or channel
- `/content create` works in any text channel, announcement channel, thread or forum post of the server (not in DMs, not in the forum's own list page, where Discord offers no commands).
- The bot posts the roster in the place where the command ran. The content stays keyed by that channel's id, so the existing rule holds: one live content per post, thread or channel.
- PvP or PvE is already chosen in the create panel (ADR 0016), so the forums are no longer needed for anything.
- **No setup is needed before first use.** Setup only names the admin roles.
- If the bot cannot see or write in that channel, creation fails the way it does today: nothing is saved, and the user gets the "Could not create the content right now" reply. I will make that reply name the likely cause (the bot needs View Channel and Send Messages there).
- **Rule unchanged (owner decision A, 2026-10-08):** a cancelled content frees the place, a finished one does not (Q15, FR-019). In a plain channel that means one finished content blocks the channel for good; the owner accepted this for now and may revisit it. No schema change is needed for this.

## 3. Admin roles
- New table `guild_admin_role (guild_id, role_id)`, row-level security on, anon revoked. Up to 10 roles per server.
- A person is an **admin** when they hold one of these roles, or have Manage Server or Administrator (the safety net, so a server can never lock itself out).
- Admins can, beside the content owner: edit, cancel, lock, unlock and mark attendance for any content; change duties; save and delete presets (ADR 0012's "officer role" becomes "admin roles").
- Creating content stays open to everyone. Joining, leaving and voting are unchanged. Ping players stays owner-only (once).
- **Who runs setup (owner decision B, 2026-10-08):** only Manage Server or Administrator, so admin roles cannot change who the admins are.
- The old single `officer_role_id` is copied into the new table by the migration and then ignored; the column stays (nothing is deleted, AGENTS rule 5).

## 4. The `/content setup` command
`/content setup` takes no options. It opens a **private panel** (owner request 2026-10-08: pick from the server's roles):
- A role picker (Discord's role select menu, a list of the server's roles that can be searched by typing), with the current admin roles already selected. Choosing or unchoosing roles saves the new set at once and the panel refreshes to show it. Up to 10 roles; `@everyone` is refused.
- A line under it names the current admin roles and says who is always an admin (Manage Server and Administrator).
- Only Manage Server or Administrator can use the command and the picker; the picker's click is checked again on the server side (never trust the client).
- Replies are private and mention nothing (allowed mentions are restricted, NFR-001).
- The `pvp-forum`, `pve-forum`, `officer-role` and `daily-cap` options are removed. `guild_settings.pvp_forum_id` and `pve_forum_id` become nullable and unused; `daily_cap` stays in the table, unused.

## 5. Daily cap dropped
FR-010 is marked dropped, with this document as the reason: the owner does not want it for now. The one-live-content-per-place rule is the only limit.

## 6. What changes in code
- `scripts/register-commands.ts`: global registration, optional one-time cleanup of the server list.
- `src/discord/commands.ts`: `/content setup` loses all its options.
- `src/handlers/create.ts`, `create-panel.ts`, `guided.ts`: `inContentPost` becomes "inside a server, in a place that can hold a message", with no settings lookup. `src/domain/forum.ts` is deleted from use.
- `src/domain/permissions.ts`: `canManage` and `canManagePresets` take the list of admin role ids.
- `src/db/settings.ts`: admin role list read and edit; `src/handlers/{manage,duty,attendance,preset,setup}.ts` use it.
- Migration `0014_admin_roles.sql`: the new table, copy of the officer role, forum columns nullable.
- Tests: any-channel creation, channel reuse after done and cancel, forum post unchanged, admin role can manage and a non-admin cannot, the setup panel shows the current roles preselected, a pick replaces the set, `@everyone` and more than 10 roles refused, setup and its picker refused without Manage Server, a forged picker click refused, command registration body, migration copies the officer role. Docs: FR-002, FR-006, FR-009, FR-010, FR-025, a new ADR 0020, ADR 0012 marked changed.

## 7. Release steps for this change
Apply migration 0014, deploy, register commands globally (also clears the old server list), then in each server run `/content setup` and pick the admin roles. Until then Manage Server and Administrator members are the admins. The current officer role keeps working through the copy.

## Decisions
- A (settled): keep the current rule. B (settled): setup only for Manage Server and Administrator.
- Approve this updated document to start building.
