---
title: Medieval Banner roster style with the Lines layout
type: decision
status: accepted
date: 2026-10-07
tags: [visuals]
satisfies: [FR-022]
---

# 0008: Medieval Banner roster style with the Lines layout

## Context
The owner asked for a catchier, fantasy-style roster post. Three themes were shown as mock-ups (Dark Fantasy, Medieval Banner, Emerald Forest) in two layouts (Lines and Columns). Discord offers no custom fonts, so style comes from colors, emoji, layout and images.

## Decision
Use the **Medieval Banner** theme with the **Lines** layout, one slot per line. The owner makes the bot icon and the banner art themselves. Content kinds (different PvP and PvE types) will vary the label and color inside the theme (FR-023). Rejected: Dark Fantasy, Emerald Forest, and the Columns layout.

## Consequences
- The roster renderer gets a theme module with colors, marks and words, kept apart from the roster rules so a theme can change without touching signup logic.
- Fancy Unicode lettering is limited to the title, because screen readers read it badly.
- Art files are supplied by the owner. Where they are hosted (for example the project's static folder on Vercel) is decided in the build.
