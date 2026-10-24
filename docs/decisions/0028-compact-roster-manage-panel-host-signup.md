---
title: Compact roster, Manage panel and host sign-up
type: decision
status: accepted
date: 2026-10-24
tags: [roster, manage, fill, waitlist, duties]
satisfies: [FR-004, FR-041, FR-047, FR-048, FR-032, FR-007]
---

# 0028: Compact roster, Manage panel and host sign-up

## Context
The owner found the live roster too tall and asked on 2026-10-20 (agreed 2026-10-24) to trim it, to let the host sign up any player, to stop offering Fill on the waitlist menu, and to add a Catcher duty. The host's controls were spread over the roster bar (Assign fill, Remove player) and slash commands (edit, lock, end, cancel, attendance, duty), and the bar could wrap to a second row.

## Decision
- **Compact roster** (supersedes the layout of FR-004 and the grouped rows of FR-041 and ADR 0021): the title is a level-2 heading (`##`, was level 1). The role headings are gone: every position is one numbered line, `n. RoleIcon Role - WeaponIcon Weapon - @Player - DutyIcon Duty` (`Open` for an empty position, the duty only when set). The Loot vote header line is removed; the counts stay on the Split and Regear buttons, which dim at the cutoff, and the result is still posted in the thread. Every spacer line is removed (after the title, after the header facts, above Fill and Waitlist). The party strip stays a level-1 heading (FR-046).
- **Manage button** (FR-048): the roster bar holds Leave, Split, Regear, Ping players and **Manage**, at most five buttons, one row. Manage opens a private panel for the creator and admins with Edit, Sign up player, Remove player, Set duty, Lock or Unlock (by status), End, Cancel and Attendance. Each button runs the same code as its command, so the rules and messages are those of the command. Set duty is a two-step menu (position, then duty or Clear). The panel is checked on every click.
- **Sign up player** (FR-047, replaces Assign fill): the panel shows the players waiting as fills first, then a member picker for anyone else, then the open positions. A player already on the roster is moved (a seated player's old position goes to the waitlist), never listed twice. The host may use a position held for a fill (FR-040 does not bind the host); the extra fill becomes a standby fill. Bots are refused. The thread gets `📝 @Host signed up @Player for position n (RoleIcon Role).`, pinging only the player. `/content assign` does the same for any member.
- **Waitlist menu**: Fill is no longer offered there (changes FR-032). Fill stays in the join menu while positions are open. Members already waiting as fills keep their place.
- **Catcher** (🪝) joins the duties after Looter (FT-016).

## Consequences
- No migration: duties are a list in code and the seat rules are enforced in the transaction.
- Rosters posted before this release keep working and take the new look at their next refresh.
- The `/content assign` description changes, so the commands are re-registered.
- The roster no longer shows when the loot vote closes.
