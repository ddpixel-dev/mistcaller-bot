---
title: Two parties for normal content, Setup Slots per party, and PvE-or-PvP forums
type: design
status: accepted 2026-11-25; built in 0.33.0
date: 2026-11-25
tags: [parties, card, guided, forums]
satisfies: [FR-081, FR-082, FR-083, FR-084]
decisions: [0050]
---

# Two parties for normal content, Setup Slots per party, and PvE-or-PvP forums

## Intent

The owner asked for four changes on 2026-11-25:

- **FR-081: two parties for normal content.** "Some content will need more than one party." It is offered on every normal content, and the host chooses. Bombers stay CTA-only.
- **FR-082: rename.** The card's **Roles** button becomes **Setup Slots**.
- **FR-083: forums.** PvE content goes to the PvE forum. Everything else (PvP, PvX, ZvZ) goes to the PvP forum. CTAs stay in the CTA channel. Today neither server has a ZvZ forum set, so ZvZ content cannot be created anywhere.
- **FR-084: Setup Slots per party.** On a two-party card, Setup Slots fills party 1 only. The owner chose option A, pick the party first, over B (both parties in one pass) and C (a party switch inside the builder).

## Guardrail check

| ID | Verdict | Note |
|---|---|---|
| FR-070, ADR 0044, ADR 0047 | supersedes in part | Two parties are no longer CTA-only. Normal content uses the same one-message roster. |
| ADR 0037 | supersedes in part | One event forum per type becomes PvE or PvP. Existing PvX and ZvZ forum settings stop being used. |
| FR-071 | consistent | Bombers stay CTA-only. |
| ADR 0030 | consistent | Positions are numbered per party and sorted by role, as for a CTA. |
| FR-076 | consistent | The slot mode applies to both parties. |
| Phase | MVP, unlocked | |

## Design

### FR-081: two parties for normal content

- **The rule.** `maxPartiesFor(kind, isCta)` returns 2 for every content. The card's **How many parties?** menu (One Party, Two Parties) shows on every card, not only CTAs. Going back to one party drops party 2, as on a CTA.
- **The card buttons.** With two parties, normal content gets the CTA's buttons: **Party 2 slots** and **Copy party 1**.
  - Party 1 is still typed in **Details** for normal content, and the box is labelled "Party 1 slots".
  - The buttons share a row with the existing ones, kept within Discord's limit of 5 per row. My call for the layout: Details, Setup Slots, Party 2 slots, Copy party 1, then Build link, Create, Cancel on the next row.
- **Checks.** `validateCard` applies the same rule as for a CTA: both parties need slots, each has at most 20, and both use the card's slot mode.
- **One message.** A two-party normal content is one roster message holding both parties. That message is the forum post's first message, as now.
  - `isOneMessage(view)` becomes `!view.blank && (view.cta || view.partyCount > 1)`.
  - `renderRosterMessage` uses the multi-party renderer (`renderCtaMessage`, renamed `renderPartiesMessage`) for the same condition.
  - Bombers render only when `view.bombers` is set, which never happens for normal content.
  - `publish` stops posting a separate party 2 message for normal content. The `content_message` table stays for 0.31.8 CTAs.
- **After creation.** Everything already built per party works unchanged: the party picker in host panels, per-party fills and waitlist, `/content me`, Edit party 1 and 2 slots, attendance and Remove player.
  - The Edit panel's **Edit party 2 slots** already shows when `partyCount === 2`.
  - Normal content keeps party 1 in Edit details, labelled "Party 1 slots".
- **Presets.** A preset keeps `party: 2` slots for normal content too. Loading one sets two parties, as for a CTA.

### FR-082: Setup Slots

The card button, its tip and `/content help` say **Setup Slots** in place of **Roles**. The builder's own title becomes "Setup Slots" too. The custom id (`cc:guided:`) does not change.

### FR-083: PvE forum, else PvP forum

- **Routing.** `forumTypeFor(type)` returns `pve` for PvE and `pvp` for every other type. `destinationOf` looks up the forum for that.
- **Setup.** `/content setup forum-type` offers only **PvP** and **PvE**. Its description changes to "PvP holds PvP, PvX and ZvZ events". The commands are registered again.
- **Old settings.** Existing `pvx` and `zvz` rows in `event_forum` are left in place and no longer read. My call: no migration and no deletion.
- **Unchanged.** Forum tags still use the content's own type and category names (`matchTags`), so a ZvZ event in the PvP forum gets the ZvZ tag if the forum has one. Statistics still count by type.

### FR-084: Setup Slots asks which party first

- **The prompt.** On a two-party card, Setup Slots (`cc:guided`) answers with a small choice, "Which party?", with **Party 1** and **Party 2** (`cc:gp:<draft>:1|2`). A one-party card goes straight to the builder.
- **State.** `slot_draft.guided_party smallint not null default 1`, in migration 0037, says which party the builder fills.
  - When the builder opens for a party, its working cards (count, slots, step) load from that party's slots.
  - Every save writes back to that party: `slots` for 1, `slots2` for 2.
  - This lives in `src/db/draft.ts` (`saveDraft` and `getDraft` map the working slots to the party's column). The builder's domain code is unchanged.
- **The builder.** It shows "Party 2" in its title when filling party 2. **Use these slots** returns to the card, with that party filled and its typed text cleared.
- **The card's hint.** The line "Roles fills party 1; use Party 2 slots for the second party." is removed.

## Approaches considered (FR-084)

| | Approach | Trade-off | Outcome |
|---|---|---|---|
| A | Pick the party first | One more click on two-party cards; one draft field | **Chosen by the owner, 2026-11-25** |
| B | Both parties in one pass | Natural first setup; fixing party 2 means redoing party 1 | Not chosen |
| C | A party switch inside the builder | Most flexible; the builder is already full | Not chosen |

## Non-goals

- Bombers for normal content.
- More than two parties.
- Moving existing posts between forums.
- Deleting old PvX or ZvZ forum settings.

## Release

One release, 0.33.0, on `feature/two-parties-setup-slots`.
- Migration 0037 adds `slot_draft.guided_party`.
- The commands change (`forum-type` choices), so they are registered again.
- Every change is test-first, and the limit checks run on the card, the builder and the two-party roster.

## My calls (for the owner to check)

1. The card's button layout for two-party normal content (see FR-081).
2. Old PvX and ZvZ forum settings are left in the database but no longer used.
3. A ZvZ or PvX event in the PvP forum still gets its own type's tag, if the forum has one.
