## Plan Review Summary

**Plan:** Fix `docs/realtime/session-lifecycle.md`
**Files Affected:** 1
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md:** WARN — no architectural concerns; this is a docs-only change.
- **RULES.md:** WARN — no code rules apply to a documentation fix.
- **ROADMAP.md:** WARN — plan covers the roadmap item for `session-lifecycle.md` but misses one stale reference that the roadmap also missed (see Critical Issues).

### Critical Issues

1. **Missing fix: `ModuleInstructionService` → `ModuleInstructionStreamService` (line 29)**

   The document says:
   > клиент отправляет сэмплы инструкций через `ModuleInstructionService`

   The proto service was renamed to `ModuleInstructionStreamService` in Phase 7.5. `database.md` already uses the correct name (line 3). No other roadmap item covers this reference in `session-lifecycle.md` — the `protocol.md` and `overview.md` roadmap items only fix their own files.

   Add a task to rename `ModuleInstructionService` → `ModuleInstructionStreamService` on line 29.

2. **Task 2 is redundant — superseded by Task 3**

   Task 2 fixes the `live_sessions` reference on line 63 inside the See Also section. Task 3 deletes the entire See Also section (lines 59–63). Implementing both means fixing a line that is immediately deleted. Remove Task 2 and fold its rationale into Task 3's description if needed.

### Suggestions

None — the remaining tasks (Task 1 and Task 3) are correct and well-specified.

### Positive Notes

- Task 1 correctly identifies the `resumed` gap and references both the enum source (`session-status.enum.ts`) and the already-fixed `database.md` as evidence.
- Task 3 proactively applies the project convention ("No See Also sections") even though the roadmap item only asked for a link fix — good attention to rules.
- Russian text for the new table row matches the language of the existing document.
