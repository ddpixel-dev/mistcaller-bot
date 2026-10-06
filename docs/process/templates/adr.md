---
title: {{DECISION_TITLE}}
type: decision
status: proposed
date: {{DATE}}
tags: []
satisfies: []
---

# {{NUMBER}}: {{DECISION_TITLE}}

<!-- status: proposed | accepted | superseded. `satisfies` lists IDs defined in PRODUCT.md, for example [FR-001, NFR-002]. -->

## Context
{{FORCES_AT_PLAY_AND_WHY_A_DECISION_IS_NEEDED}}

## Decision
{{WHAT_WE_DECIDED_AND_WHAT_WE_REJECTED}}

## Consequences
{{WHAT_GETS_EASIER_AND_WHAT_GETS_HARDER}}

<!-- If this replaces an earlier decision, set the old one to `status: superseded` and add "superseded by NNNN" there. -->

<!-- Recording a waived POC: use tags: [poc-waiver], and fill the sections like this:
     Context:      the user chose to skip the proof-of-concept phase.
     Decision:     the POC is waived; the plan is MVP only; no POC checks exist and there is no POC gate.
     Reason:       {{WHY_IT_IS_SAFE_TO_SKIP, IN_THE_USERS_WORDS}}
     Consequences: the riskiest assumptions are validated inside the MVP; revisit if one of them fails. -->
