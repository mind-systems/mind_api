# Review: Change Event Emission (iteration 2)

## Scope

Files changed (vs HEAD):
- `src/changelog/changelog.events.ts` (new) — event constant + payload interface
- `src/changelog/index.ts` (new) — barrel re-export
- `src/breath-sessions/breath-sessions.service.ts` (modified) — changelog + emitter integration
- `src/breath-sessions/breath-sessions.service.spec.ts` (modified) — mocks for new dependencies
- `.ai-factory/plans/03-change-event-emission.md` (new) — plan file
- `.ai-factory/reviews/03-change-event-emission-review-1.md` (new) — previous review

## Review 1 fix verified

The critical issue from review 1 (broken tests due to missing constructor args) has been fixed. All 4 `beforeEach` blocks now pass `mockChangeLogService` and `mockEventEmitter`. All 13 tests pass. No new TS compilation errors introduced by this changeset.

## Correctness checks

- **DI wiring:** `ChangelogModule` is `@Global()` and exports `ChangeLogService` — no import needed in `BreathSessionsModule`. `EventEmitterModule.forRoot()` is registered in `AppModule`. Both injectable without module changes. Correct.
- **No missing migrations:** This changeset adds no entities or schema changes — `change_events` table was created in the prior milestone. Correct.
- **Event constant naming:** `'changelog.logged'` follows the `domain.action` pattern used by the realtime module (`live_session.paused`). Consistent.
- **Payload interface matches `log()` signature:** `ChangeEventPayload` fields (`entity`, `refId`, `action`, `userId`) mirror the `ChangeLogService.log()` parameters exactly. The same values are passed to both. No mismatch.
- **All 4 mutation paths covered:** `create` → `'created'`, `update` → `'updated'`, `replace` → `'updated'`, `remove` → `'deleted'`. Correct per plan.
- **Emit ordering:** `log()` is awaited before `emit()` in every path — the DB row exists before any listener runs. This is the right order for a listener that might read the event back from the DB.
- **`emit()` is fire-and-forget:** `EventEmitter2.emit()` is synchronous. No `await` needed, none used. Consistent with the existing pattern in `ActivityEngine`.

## No issues found

REVIEW_PASS
