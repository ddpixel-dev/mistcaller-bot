---
title: Roster joining, header lines and weapon icons: options for the owner
type: plan
status: proposed
date: 2026-10-07
---

# Roster joining, header lines and weapon icons: options

Nothing here is built. Each part ends with a recommendation and the decision needed from the owner.

## 1. Joining and leaving: better options

### Today (release 0.9.0)
One button per position, then a row with Leave and the vote buttons. Taken positions are dimmed.

```
[🛡️ 1. Tank - Great Axe] [💚 2. Healer - Holy Staff] [✨ 3. Support - Occult] [⚔️ 4. DPS - Bow] [⚔️ 5. DPS - Bow]
[🛡️ 6. Tank - Mace    ] ... (up to 4 rows of 5)
[🚪 Leave] [Split (3)] [Regear (2)]
```
Weak points: tall for big rosters, long labels get cut at 80 characters, one wall of identical buttons, and the Leave button is shared by everyone.

### Option A: role buttons that join for you (one click)
```
[🛡️ Tank] [💚 Healer] [✨ Support] [⚔️ DPS] [🚪 Leave]
[Split (3)] [Regear (2)]
```
- Pressing a role joins the first open position of that role. The reply is private and short: "You joined 2. Healer - Holy Staff. Want a different healer slot? Pick one" with a menu of the other open slots of that role.
- A role with no open position is dimmed. When the whole roster is full, the buttons become "Join the waitlist" (FR-007).
- Pros: one click, fits a phone, always five or fewer buttons, matches how players think ("I am a healer").
- Cons: a player cannot choose the exact weapon in one click (one more step through the private menu).

### Option B: one Join button and a private picker
```
[✅ Join] [🚪 Leave] [Split (3)] [Regear (2)]
```
- Join opens a private panel listing only the open positions (a menu), with Leave enabled for that member only (the `/content me` panel, opened by a button).
- Pros: the roster message stays clean; the private panel can show your current slot, Move and Leave.
- Cons: always two steps.

### Option C: roles plus a picker (my recommendation)
```
[🛡️ Tank] [💚 Healer] [✨ Support] [⚔️ DPS] [📋 Pick a slot]
[🚪 Leave] [Split (3)] [Regear (2)]
```
- The role buttons are one-click joins (Option A). "Pick a slot" opens the private picker (Option B) for people who want a specific position. Leave stays on the roster.
- Pros: fast for most, precise when needed, a short bottom area that never grows with the roster size.
- Cons: two ways to do one thing, which has to be explained once in the message.

### Option D: keep the buttons per position, but only for open positions
The same grid as today, but taken positions are removed instead of dimmed, so the grid shrinks as the party fills.
- Pros: tiny change.
- Cons: the message moves around, and nothing about the look improves much.

**Waitlist (FR-007) fits all options:** when nothing is open, the join buttons turn into "Join the waitlist".

**Decision needed:** A, B, C or D?

## 2. Header lines: tier and loot vote on separate lines with icons

Today the type, tier and loot vote share one line. Proposed (icons are suggestions):

```
⚔️ PvP · ZvZ
🛡️ Tier: T5.3 – T7.0
💰 Loot vote: On
🕰️ UTC · Wed 7 Oct 2026, 18:00 UTC
🌍 Your time · 7 October 2026 9:00 PM · in 2 hours
```
- Each fact has its own icon and line, so they scan easily on a phone.
- The vote status line below the header ("💰 Spoils vote: Split 3 · Regear 2 · closes …") stays as it is.
- With the loot vote off the second line reads `💰 Loot vote: Off`.

**Decision needed:** are these icons right (tier 🛡️, loot vote 💰), and should the order be type, tier, loot vote, UTC, your time?

## 3. Why weapon names show no icon, and the ways to fix it

**Why:** Discord does not draw an image inside text. In an embed, an image can only sit in a few fixed places: one thumbnail, one large image, the author icon and the footer icon. The only picture that can sit inside a line of text, a button or a menu option is a custom emoji. Linking the render service gives us picture URLs, so today an icon appears only as the single thumbnail on the guided card, and nowhere on the roster.

### Option 1: custom emoji for every weapon (best look)
```
🛡️ 1. <icon> Great Axe · 📯 Caller · sworn: @Ana
```
- The bot would upload the 155 weapon icons once as application emoji (an app may own up to 2,000, usable in any server for free). The icon then appears inline in roster lines, buttons and menu options.
- Cost: it copies game art into Discord, so the rights question from ADR 0011 comes back (permission from the game's publisher is needed, and ADR 0013 chose linking to avoid this). It also needs a one-time upload script and a mapping from weapon to emoji.
- Decision: do you want to ask for that permission, or accept the risk?

### Option 2: one small embed per slot with the icon beside the name (no uploads)
```
[icon] 1. Tank - Great Axe · 📯 Caller
[icon] 2. Healer - Holy Staff
```
- Each slot becomes its own embed whose author line shows the linked icon at the left of the name.
- Limit: Discord allows 10 embeds in a message. One header embed plus nine slots fits parties of up to nine. Larger parties would fall back to text lines without icons (or show icons for the first nine).
- Cost: no art is copied (it is linked). The message becomes taller and looks different from today: each slot line has its own box and colour bar.

### Option 3: icons only where they are cheap
- Keep the roster as text. Show the icon as the thumbnail of the guided card (done) and as the thumbnail on `/content weapon`.
- Zero work, no icons on the roster.

**My recommendation:** Option 1 if the owner is comfortable asking for permission, because it is the only one that gives the look of an inline icon next to the weapon in the roster, the buttons and the menus. If not, Option 3 now, and Option 2 only for small parties if the layout is acceptable.

**Decision needed:** 1, 2 or 3?

## Summary of decisions needed
1. Joining and leaving: A, B, C or D.
2. Header lines: confirm the icons and order.
3. Weapon icons: 1, 2 or 3 (and, for 1, whether to ask for permission).
