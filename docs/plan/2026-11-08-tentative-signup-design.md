---
title: Tentative sign-up design
type: plan
status: accepted (owner approved 2026-11-08; built in 0.31.6)
date: 2026-11-08
satisfies: [FR-067]
---

# Tentative sign-up (FR-067)

## Goal
A player who signed up can say "I might not make it". Everyone, and the host most of all, sees a ❓ beside their name, so the host can plan the party and fill the gap. Owner request 2026-11-08; the owner chose a toggle button (option A).

## Behaviour
- A shared **❓ Tentative** button sits beside **Leave** on the roster. Like Leave it is one button for everyone, because Discord cannot show a control for some viewers only. It acts on the player who pressed it: pressed once it marks them tentative, pressed again it clears it.
- A player with no sign-up gets a private "Sign up first" reply. The button is dimmed while nobody is signed up (the same rule as Leave).
- It works while the content is open or locked. It is only information, so it is still useful once sign-ups are locked. Finished or cancelled content refuses it.
- The ❓ shows beside the name wherever the player is listed:

| Where | Reads |
|---|---|
| Seat | `3. 💚 Healer - 🗡️ Hallowfall - <@p> ❓` |
| Applicants | `📨 Applicants (2): <@a> ❓ (Healer, #7) · <@b> (Any)` |
| Fill | `🔁 Fill (1): <@c> ❓ (Any)` |
| Waitlist | `1. <@d> ❓ (Healer)` |

- The host's **Review applicants** and **Assign player** menus mark tentative players in the option description (`❓ Tentative`), so the host sees it when choosing.
- The flag follows the player: accepted from applicants, seated from a fill, promoted from the waitlist, moved by themselves or by the host. It never clears by itself. Leaving removes it, so signing up again starts confirmed.
- Tentative players still count in the party total, are still pinged and reminded, and attendance is unchanged. Nothing about seats or the waitlist changes: a tentative player holds their seat.

## Not included (decide later if wanted)
- A tentative count in the roster header or the calendar.
- Any automatic action on tentative players, such as releasing the seat at a deadline.

## Design
- **Data:** migration 0030 adds `tentative boolean not null default false` to `signup`. Every move is an upsert that names the columns it changes, so the flag survives them without code changes (checked in `claimSlot`, `assignPlayer`, `joinFill` and `promoteWaitlist`). Leave deletes the row.
- **Order of deploy:** the code reads the column, so migrate production first. The migration is additive.
- **Domain/DB:** `setTentative(sql, { contentId, guildId, userId, value })` in `src/db/signup.ts`: one update of the player's own row; results `ok`, `not_signed`, `unavailable`, `not_found`. Toggle = read the current value and flip it in one statement.
- **View:** `RosterView.tentative?: string[]` (user ids), read in `getRosterView` with one extra query. `src/render/roster.ts` appends ` ❓` after the mention in the four places above.
- **Handler:** `tent:<content>` in `src/handlers/signup.ts`, registered in `src/discord/dispatch.ts`. It answers by updating the shared roster message, like Leave. Old (embed) rosters get the existing "older layout" reply.
- **Buttons:** Leave, Tentative, the two vote buttons, Ping and Manage make six when the loot vote is on, so Manage moves to a second row (Discord allows five per row).
- **Security:** the player is the verified interaction user, never an id from the client; the content must belong to the interaction's guild.

## Tests
- DB: toggle on and off; refused with no sign-up and on finished content; the flag survives a move, a waitlist promotion, a fill being seated, an applicant being accepted and a host move; it resets after leaving.
- Render: ❓ in each of the four places; none when nobody is tentative; the text-size trimming still holds; no component limit problems (`discordProblems`); every button icon is a real emoji.
- Handler: signed-up player toggles; stranger refused; stale or forged ids refused; old roster message.

## Records
FR-067 and ADR 0042 in the same turn as the code; a line in `changelog/` for the release.
