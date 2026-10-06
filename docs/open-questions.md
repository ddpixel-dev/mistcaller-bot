---
title: Open questions, assumptions, and risks
type: log
status: active
date: 2026-10-06
---

# Open questions, assumptions, and risks

Anything uncertain goes here instead of being assumed. Resolve an entry by recording the answer (an ADR or a `PRODUCT.md` change) and marking it resolved; do not delete it.

| ID | Kind | Question or risk | Affects | Status | Resolution |
|---|---|---|---|---|---|
| Q1 | risk | Does a 5-minute GitHub Actions schedule post the vote result early enough? Free-tier schedules can be delayed or skipped | FR-008, FR-013 | open | Measured in CHK-005. Alternative: `pg_cron` (see ADR 0002) |
| Q2 | question | Are `pg_cron` and `pg_net` usable on the Supabase free tier, in case the alternative is needed? | FR-013 | open | |
| Q3 | risk | Does Supabase pause the free project during a quiet week? | NFR-003 | open | Measured in CHK-007 |
| Q4 | risk | Vercel Hobby is non-commercial. Fine for the guild, but it blocks monetization | NFR-003 | open | Revisit before FT-010 |
| Q5 | question | Do GitHub scheduled workflows on a public repo get disabled after inactivity, and what are the free minutes for a private repo? | FR-013 | open | Verify at M3 |
| Q6 | question | Can the Supabase Data API be turned off entirely? Otherwise row-level security with no policies stays the guard | NFR-001 | open | The guard works: all tables answer 401/42501 to the anon key (CHK-006). Switching the Data API off entirely is optional hardening, still to check in the dashboard |
| Q7 | question | Does the bot work as expected inside forum posts: permissions in threads, and locked or archived posts? | FR-002 | open | Verify at M1 |
| Q8 | question | Privacy note and delete-my-data path for public use; Discord's requirements for verification and privacy policy | NFR-006, FT-010 | open | Before FT-010 |
| Q9 | question | Product name | | open | Before publishing |
| Q11 | risk | Does Vercel's build accept web-standard `POST` exports and `.ts` import specifiers with no bundler? If not, the owner decides whether to add a build tool | NFR-003 | open | Verified at plan Task 4 |
| Q12 | question | Should a member's vote be removed when they leave? Decided yes (FR-008: only signed-up members vote); implemented in `leaveContent` | FR-008 | resolved | A leaver loses their vote; leaving and rejoining means voting again |
| Q13 | risk | Which Vercel region runs the functions? Supabase is eu-west-1 (Ireland), so use Dublin (`dub1`) to keep database round trips short inside the 3-second limit | NFR-002 | open | Set in the Vercel dashboard before CHK-004 |
| Q14 | question | Edit and cancel content (owner request 2026-10-06). Who can do it is settled (ADR 0003). Open: which fields can be edited, how slot edits behave when someone is signed up, and cancel confirmation | FT-005, FR-009 | open | MVP phase (M4); needs a design before work starts |
| Q15 | question | Limit one content per forum post (owner request 2026-10-06). Open: may a new content be created in the same post after a cancel, or after the content is done | FR-002, FR-010 | open | Needs a new requirement; a database rule such as one active content per thread is the likely shape |
| Q16 | question | Better visuals: a fantasy look for the roster message (owner request 2026-10-06). Discord allows no custom fonts; styling comes from colors, emoji, layout and images. Open: theme direction, whether to use images, and avoiding game art we have no rights to | FR-004 | open | Needs a design and an NFR for readability and accessibility |
| Q10 | question | Does a modal support a loot dropdown? Current choice: loot is a command option | FR-003 | resolved | Command option, per the agreed design |
