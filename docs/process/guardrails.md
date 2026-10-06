---
title: Guardrails and audit
type: process
status: active
date: 2026-10-06
---

# Guardrails and audit

Run this before any plan, design, or new feature, and whenever something is proposed that might contradict what we agreed.

## The guardrail check

1. **Restate** the proposed change in one line.
2. **Find related records:** IDs and keywords in `PRODUCT.md`, accepted ADRs in `docs/decisions/` for that area, and `docs/architecture/overview.md`.
3. **Classify each hit:**
   - `consistent`: it fits.
   - `conflicts`: it contradicts a requirement or a decision.
   - `supersedes`: it deliberately replaces an earlier decision.
   - `gap`: nothing covers it. That means scope creep or a missing requirement.
4. **Phase check:** which phase does this belong to (POC, MVP, later), and is that phase unlocked? Work from a locked phase is flagged, not started.
5. **Report** in this exact format, then stop and ask when there is any `conflicts` or `gap`:

   | ID | Verdict | Note |
   |---|---|---|
   | FR-003 | conflicts | why |

   On a conflict offer two options: adjust the change, or amend the requirement or ADR (superseding it) with the user's approval.
6. **Record** the outcome (ADR, `PRODUCT.md` change, or open question), then update `docs/INDEX.md` and the Current state in `PRODUCT.md`.

## The audit

Run at milestones and before big changes. Each command prints one line per finding, and nothing when there is none.

```bash
# 1. Docs that are not linked from the index
for f in $(find docs -name '*.md' -not -path 'docs/process/templates/*' -not -name INDEX.md); do
  grep -q "${f#docs/}" docs/INDEX.md || echo "NOT INDEXED: $f"
done

# 2. IDs defined in PRODUCT.md that nothing under docs/ cites (docs/process/ holds examples, so it is skipped)
for id in $(grep -oE '^#{3,4}[[:space:]]+(FT|FR|NFR|CHK)-[0-9]{3}' PRODUCT.md | grep -oE '(FT|FR|NFR|CHK)-[0-9]{3}'); do
  grep -rq --exclude-dir=process "$id" docs || echo "UNCITED: $id"
done

# 3. IDs cited under docs/ that PRODUCT.md does not define
grep -rhoE --exclude-dir=process '(FT|FR|NFR|CHK)-[0-9]{3}' docs | sort -u | while read -r id; do
  grep -qE "^#{3,4}[[:space:]]+$id" PRODUCT.md || echo "UNDEFINED: $id"
done

# 4. Superseded decisions with no replacement link
for f in $(grep -l '^status: superseded' docs/decisions/*.md 2>/dev/null); do
  grep -q 'superseded by' "$f" || echo "NO REPLACEMENT LINK: $f"
done
```

Fix whatever prints, then update `docs/INDEX.md`. An "uncited" ID is not always wrong (a requirement may simply not have work yet); judge it, and note the decision if you keep it.
