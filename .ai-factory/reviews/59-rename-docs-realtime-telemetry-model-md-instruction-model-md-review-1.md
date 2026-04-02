## Code Review: Rename `docs/realtime/telemetry-model.md` → `instruction-model.md`

**Plan:** `.ai-factory/plans/59-rename-docs-realtime-telemetry-model-md-instruction-model-md.md`
**Files Changed:** 4 (`docs/realtime/telemetry-model.md` → `instruction-model.md`, `docs/realtime/protocol.md`, `CLAUDE.md`, `AGENTS.md`)

### Summary

Pure rename of a doc file plus updating all inbound references. No code, no migrations, no runtime impact.

### Verification

| Check | Result |
|-------|--------|
| Old file `telemetry-model.md` no longer exists | ✓ |
| New file `instruction-model.md` exists with identical content (similarity index 100%) | ✓ |
| `protocol.md` See Also link updated to `instruction-model.md` | ✓ (line 60) |
| `CLAUDE.md` doc table path updated to `docs/realtime/instruction-model.md` | ✓ (line 113) |
| `AGENTS.md` doc table path updated to `docs/realtime/instruction-model.md` | ✓ (line 45) |
| No stale `telemetry-model` references remain outside `.ai-factory/` | ✓ (grep confirmed) |
| `session-lifecycle.md` — no link to update (never had one) | ✓ |
| `database.md` — no link to update (never had one) | ✓ |
| Renamed file content unchanged — no unintended edits | ✓ |

### Issues

None found.

REVIEW_PASS
