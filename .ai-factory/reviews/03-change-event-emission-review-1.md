## Code Review Summary

**Files Reviewed:** 4
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md:** WARN — no issues. `ChangelogModule` is `@Global()` and exports `ChangeLogService`, so `BreathSessionsService` correctly consumes it without an explicit module import. `EventEmitterModule.forRoot()` is registered in `AppModule`. No cross-module boundary violations.
- **RULES.md:** WARN — no violations. No non-null assertions (`!`), no sensitive data in logs. Changelog calls don't introduce any logging.
- **ROADMAP.md:** No issues. Milestone "Change Event Emission" is marked complete, matching the implemented state.

### Critical Issues

None.

### Suggestions

1. **Test mock returns `undefined` instead of `number` for `changeLogService.log()`.**
   `ChangeLogService.log()` returns `Promise<number>` (the inserted event ID). The test mocks use `mockResolvedValue(undefined)`, so `eventId` is `undefined` in test context and `payload.id` becomes `undefined` — violating the `ChangeEventPayload` interface (`id: number`). The tests pass because nothing asserts on the emitted payload, but the mocks are inaccurate.
   Fix: change to `mockResolvedValue(1)` in all 4 `beforeEach` blocks (lines 43, 86, 132, 178 of the spec file).

### Positive Notes

- All 4 mutation paths (create, update, replace, soft-delete) are covered with matching changelog + emitter calls — no mutation is missed.
- `log()` is awaited before `emit()` in every path, ensuring the DB row exists before any listener fires. Correct ordering for downstream consumers that might read back from the DB.
- `emit()` is correctly fire-and-forget (synchronous, no `await`) — consistent with existing `EventEmitter2` usage in the codebase.
- `ChangeEventPayload` includes `id` (the auto-increment event ID from `change_events`) which gives downstream listeners (like `SyncNotifierService`) a cursor reference without a second query.
- Barrel re-export in `src/changelog/index.ts` uses `export type` for the interface — correct TypeScript practice for type-only exports.
