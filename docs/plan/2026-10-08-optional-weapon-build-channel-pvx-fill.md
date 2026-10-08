---
title: Optional weapon, build channel, PvX and Fill: design
type: plan
status: proposed
date: 2026-10-08
satisfies: [FR-003, FR-005, FR-023, FR-030, FR-031, FR-032, FR-033]
---

# Optional weapon, build channel, PvX and Fill

Written for the owner's approval. Nothing here is built. Owner answers so far (2026-10-08): a role-only slot lets the player pick a weapon privately after joining; fill players count as signed up; the owner assigns a fill with a button and with a command; Fill is an entry of the join menu and of the waitlist menu; one build channel per event, limited to channels that can be mentioned; a new content type PvX holding every PvP and PvE category.

Four changes, four releases, in this order: **1** optional weapon, **2** build channel, **3** PvX, **4** Fill. Each has its own migration and tests, and none depends on a later one.

## Guardrail check
- FR-003 says each slot is `Role - Weapon`; FR-030 relaxes it. FR-023 and ADR 0016 know two types; FR-033 adds a third. FR-005 says a member holds one active entry per content; Fill is a third status of that one entry, so it still holds. FR-007 (waitlist per role) is unchanged; Fill is separate from it.
- ADR 0010 (fixed list in code) stays: PvX reuses the same list.

## 1. Optional weapon (FR-030)
**Slots.** `slot.weapon` is already nullable. A slot may be a role alone (a duty can still be added).
- Typed lines: `Tank`, `Tank (Caller)` and `Tank - Mace` are all valid.
- Guided steps: Weapon class and Weapon say "optional". Next and Finish need only a role; choosing a class without a weapon is allowed. `/content slot role weapon duty` makes `weapon` optional.
- Presets keep role-only slots.

**Roster.** A role-only slot reads `1. Player's choice · Open`. Once the player picks a weapon it reads `1. 🪓 Bear Paws · Sworn: @Ana`, with the icon. The join-menu option reads `1. Tank`, with the role icon.

**The player's weapon.** New column `signup.chosen_weapon` (text, nullable).
- When a player joins a role-only slot, the roster is updated by an edit of the roster message and the player gets a **private** picker: a weapon-class menu, a weapon menu and a Skip button. Choosing saves the weapon and refreshes the roster.
- Joins into slots that have a weapon work as today: no private message (the owner asked for none, 2026-10-07).
- `/content me` shows a **Change weapon** button for a player in a role-only slot.
- Moving to a slot that has a weapon clears the choice. Leaving clears it. Moving between role-only slots keeps it.

**Tests.** Parse (role only, with duty), guided steps without weapon, render of both states, join into role-only versus weapon slots (picker or none), choice saved and cleared, `/content me`, limits checker on the picker.

## 2. Build channel (FR-031)
- New column `content.build_channel_id`.
- `/content create build-channel:#channel` (optional, a searchable channel list) is carried through the create panel into the roster. `/content edit build-channel:#channel` changes it; `clear-build: true` removes it (Discord cannot unset a channel option).
- Allowed channel types: text, announcement, forum and thread. The id is checked against the channels Discord resolves for the command, so a made-up id is refused.
- Roster header gets a line `🧰 **Build**  <#channel>`, a clickable mention that pings nobody. The header padding gets a measured count for the new label (to calibrate from a screenshot after release).
- The id travels in the create panel's `custom_id`; a test checks the worst case stays under Discord's 100 characters.

## 3. PvX (FR-033)
- New content type `pvx`, chosen in the create panel next to PvP and PvE. Migration 0018 widens the type checks of `content` and `slot_draft`.
- Its categories are every PvP category followed by every PvE category, with Other once (18 entries, within the menu limit). `kindDef`, `resolveKind` and the colours take the type into account; the roster header shows `PvX · ZvZ`.
- Guided steps, presets and the weapon lists are unchanged.

## 4. Fill (FR-032)
**Data.** `signup.status` gains `fill` (no slot). Migration 0019 widens the check. A fill player is a signed-up member without a position and without a limit.

**Joining.** The join menu gets a first entry **🔁 Fill (play any position)**. When the roster is full, the waitlist menu gets the same entry (value `~fill`, so it cannot clash with a role named Fill). Choosing it:
- from nothing: becomes a fill;
- from a position: frees the position (the waitlist is promoted as when leaving) and becomes a fill;
- from a waitlist: becomes a fill;
- a fill picking a position: takes it like a normal join.

**Roster.** A line `🔁 **Fill (2):** @Ana · @Ben` sits between the rows and the waitlist line (cut to 600 characters like the waitlist). **Leave** works for a fill and is enabled while a fill exists.

**What counts.** A fill is signed up for leaving, voting, Ping players, the 30-minute reminder, the attendance form, the attendance message and `/content history`. Every query that reads `signup.status = 'signed'` for people is audited and gets the same treatment, with a test per place.

**The owner assigns** (creator and admins):
- **Assign fill** button on the roster, shown only while a fill exists. It opens a private panel: a menu of the fill players (server names), then, after one is chosen, a menu of the **open** positions. A position that is already taken cannot be chosen.
- `/content assign position:<n> member:@user` does the same. It works only for a fill and an open position.
- Either way, the fill takes the position in one transaction, the roster refreshes, and a short line goes into the thread: `@Ana is now in position 3.` (no other pings).
- Fills are never seated automatically; only the owner places them. Assignment is allowed while open or locked, not after done or cancelled.
- The buttons row holds at most five buttons; with the loot vote it is Leave, Split, Regear, Ping players and Assign fill, which fits.

**Tests.** The joins above, one entry per member, atomic assignment (two owners at once, a taken position, a player who left meanwhile), refusal for non-owners, the command and the button path, the audit list, render with and without fills, and the limits checker.

## Release plan
| Release | Contains | Migration | Commands |
|---|---|---|---|
| next | 1 optional weapon | 0016 `signup.chosen_weapon` | `slot` option optional (re-register) |
| after | 2 build channel | 0017 `content.build_channel_id` | new options (re-register) |
| after | 3 PvX | 0018 type checks | none |
| last | 4 Fill | 0019 `signup.status` | `assign` (re-register) |

Each release stops for the owner to test before the next starts.

## Decisions I made for you (change any of them)
- The weapon picker comes only for role-only slots.
- A fill is never seated automatically and has no limit.
- Fill players are shown by mention on the roster.
- Assignment only into open positions (no swapping with a seated player).
- The build link is one per event.
