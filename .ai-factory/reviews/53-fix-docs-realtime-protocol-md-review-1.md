## Code Review: Fix `docs/realtime/protocol.md`

**Plan:** `.ai-factory/plans/53-fix-docs-realtime-protocol-md.md`
**Scope:** 1 file changed (`docs/realtime/protocol.md`), 2 new files (plan + plan review)

### Changes Verified

| Check | Result |
|-------|--------|
| Line 3: `ModuleInstructionService` → `ModuleInstructionStreamService` | ✅ Correct |
| Line 26: section header renamed | ✅ Correct |
| Name matches proto definition (`proto/module_instruction_stream.proto:69`) | ✅ Matches |
| No unintended changes to surrounding text | ✅ Clean |
| `ModuleStateService` references unchanged | ✅ Untouched |
| No remaining `ModuleInstructionService` in `protocol.md` | ✅ Zero occurrences |

### Issues

None in the changed file.

### Out-of-scope observation

Two other doc files still reference the old name `ModuleInstructionService`:
- `docs/realtime/configuration.md:11` — `ModuleInstructionService` in the description of `WS_TELEMETRY_MAX_PAYLOAD_BYTES`
- `docs/realtime/telemetry-model.md:99` — link text `описание ModuleInstructionService`

These are not part of this task's scope but should be addressed in their respective fix plans.

REVIEW_PASS
