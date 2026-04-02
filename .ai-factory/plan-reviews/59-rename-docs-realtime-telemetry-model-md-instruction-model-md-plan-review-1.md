## Plan Review: Rename `docs/realtime/telemetry-model.md` → `instruction-model.md`

**Plan:** `.ai-factory/plans/59-rename-docs-realtime-telemetry-model-md-instruction-model-md.md`
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md:** WARN — not applicable (docs-only rename, no code or module changes).
- **RULES.md:** WARN — not applicable (no TypeScript code involved).
- **ROADMAP.md:** OK — plan maps to the unchecked Phase 12 item: "Rename `docs/realtime/telemetry-model.md` → `instruction-model.md`".

### Verification

All plan assumptions verified against the current codebase:

| Claim | Result |
|-------|--------|
| `docs/realtime/telemetry-model.md` exists | ✓ Confirmed |
| `protocol.md` line 60 references `(telemetry-model.md)` | ✓ Confirmed |
| `CLAUDE.md` line 113 has path `docs/realtime/telemetry-model.md` | ✓ Confirmed |
| `AGENTS.md` line 45 has path `docs/realtime/telemetry-model.md` | ✓ Confirmed |
| `session-lifecycle.md` has no link to `telemetry-model.md` | ✓ Confirmed — no See Also section, no references |
| `database.md` has no link to `telemetry-model.md` | ✓ Confirmed — no references |

Exhaustive `grep` for `telemetry-model` across the entire `mind_api/` tree found no additional live references beyond the three the plan already covers. All other hits are in `.ai-factory/` metadata (old plans, reviews, notes, roadmap) which are historical records and don't need updating.

### Positive Notes

- Correct use of `git mv` for history preservation.
- Plan correctly overrides the stale roadmap milestone (which listed three inbound-link files) with the actual codebase state (only `protocol.md` has an inbound link).
- Plan caught `AGENTS.md` as a reference site, which the roadmap milestone omitted entirely.
- Scope is appropriately minimal — no unnecessary changes.

PLAN_REVIEW_PASS
