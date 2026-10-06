---
title: Recording rules
type: process
status: active
date: 2026-10-06
---

# Recording rules

Everything we discuss and decide is recorded where an agent can find it later. Record in the same turn the thing happens.

| What happened | Where it goes |
|---|---|
| A decision was made (including rejected options worth remembering) | An ADR in `docs/decisions/NNNN-title.md`, citing the requirement IDs it serves in `satisfies:` |
| A requirement, feature, or POC check was added, changed, or dropped | `PRODUCT.md`, under its ID (never restate it elsewhere) |
| A phase, feature, or check changed status | The Current state section of `PRODUCT.md`, plus the status in the milestone or task that tracks it |
| Something is unknown, assumed, or risky | `docs/open-questions.md` |
| We learned something | `docs/lessons.md` (dated) |
| A design or brainstorm worth keeping | `docs/discussions/` |
| Architecture changed | `docs/architecture/overview.md` and an ADR |
| The plan or order of work changed | `docs/plan/` (roadmap, milestones, tasks) |
| Any document was added, moved, or superseded | `docs/INDEX.md` |

## Rules

- **Never delete finished records.** Mark decisions `superseded` (with "superseded by NNNN"), requirements and features `dropped`, and link the replacement.
- **One home per fact.** Requirements live only in `PRODUCT.md`. Other documents cite IDs.
- **Every doc under `docs/`** has frontmatter: `title`, `type`, `status`, `date`.
- **Uncertain means open question,** not an assumption and not an invented number.
- **Keep `AGENTS.md` lean.** Put detail here and in the docs, and link to it.
