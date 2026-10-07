<!-- buildit:begin -->
## Project: Content Roster Bot

A Discord bot for an Albion Online guild. A member runs `/content create` in a PvP or PvE forum post. The bot posts a live roster: start time in UTC plus each viewer's local time, a gear tier or range, one row per slot (role plus weapon), a waitlist, a loot vote (split or regear) and attendance history.
Stack: TypeScript, Vercel serverless endpoint with Discord HTTP interactions (no gateway), Supabase Postgres, GitHub Actions for scheduled jobs. Free tiers only. Single guild first, every table keyed by guild id.

## Source of truth

Read `PRODUCT.md` and `docs/INDEX.md` first. They hold the product definition, every requirement (with IDs), the phases, the current state, and links to the decisions, architecture, and plan. Details live in `docs/`, not in this file.

## Rules

1. **Check before you change.** Before any plan, design, or new feature, run the guardrail check in `docs/process/guardrails.md`.
2. **Report conflicts, never override.** If a change contradicts a requirement or decision, say which IDs, and ask before proceeding.
3. **Phase gate.** Do not start MVP work until the POC is validated and recorded in `PRODUCT.md`. A change that belongs to a later phase gets flagged first.
4. **Record as you go, in the same turn:** decisions to ADRs in `docs/decisions/`, requirement and feature changes in `PRODUCT.md`, unknowns to `docs/open-questions.md`, lessons to `docs/lessons.md`. Update `docs/INDEX.md` and the Current state in `PRODUCT.md`.
5. **Never delete, supersede.** Mark old decisions and requirements superseded or dropped and link the replacement.
6. **Run the audit** in `docs/process/guardrails.md` at milestones and before big changes.
7. **Keep this file lean.** Put detail in the docs and link to it. When requirements change materially, update the summary above.

## Project-specific

- Tooling: never install third-party tools or packages on the host. Run every tool in Docker (`docker compose run --rm node ...`) and ask the owner before adding any package (ADR 0006).
- Build and test: `docker compose run --rm node npm test` once the scaffold exists (plan Task 1). Record any further commands here.
- Conventions: no product code, dependency installs or scaffolding until the owner approves the written implementation plan. Keep domain logic pure with no Discord or database imports (NFR-007).
- Security: verify every Discord signature before parsing; never trust client-supplied IDs, use only the verified user and guild; secrets only in environment variables, never in the repo or logs; row-level security stays on for every table; send every bot message with restricted allowed mentions (NFR-001, FR-018).
- Responsiveness: acknowledge every interaction within 3 seconds, then finish by editing the message (NFR-002).
- Data: every table carries a guild id and times are stored in UTC; unknown or unmarked attendance is never counted as a no-show (NFR-004, FR-014).
- Reliability: keep no state in memory, make scheduled actions idempotent, and enforce the vote cutoff in the click handler (NFR-005).
- Cost: free tiers only. Get the owner's approval before adding any paid service or new dependency (NFR-003).
- Git: follow git flow (ADR 0014). Work on `feature/<id>-<name>` branches from `develop`; `main` is releases only, tagged. Manage branches and say which one you are on.
<!-- buildit:end -->
