# Code Review — Tests: bio ingest bound to root (review 2)

**Scope:** Milestone-06 code changes are the two Jest spec files below. The working tree contains many other modified files (`src/sessions/biometric-aggregation.util.ts`, `multi-session-lifecycle.spec.ts`, `session-watchdog.service.spec.ts`, etc.) — these predate this milestone (present in the initial working-tree snapshot, products of prior test milestones 02–05) and are out of scope here. The planning artifacts (ROADMAP, note 21, plan/json/plan-review) are not runtime code.

**Files reviewed:**
- `src/realtime/module-biometric-stream.grpc.controller.spec.ts` (+196)
- `src/realtime/services/biometric-stream-engine.service.spec.ts` (+89)

## Changes since review 1

The author addressed both review-1 findings:

| Review-1 finding | Status | Evidence |
|---|---|---|
| 1 — new code not lint-clean (~25 new ESLint errors) | **Resolved** | `makeRoot` dropped `'root' as any` → `'root'`; the four target cases use the now-properly-typed `activityEngine.ensureRoot.mockResolvedValue(...)` (no `(activityEngine as any)` → no `no-unsafe-call`/`no-unsafe-member-access`); the overflow samples are typed `BioSampleInternal` (no `as any` → no `no-unnecessary-type-assertion`); prettier formatting applied. |
| 2 — overflow test couples to hard-coded byte cap (nit) | **Addressed** | Added inline comment documenting `BIO_STREAM_MAX_BUFFER_BYTES = 1000 from makeConfig default`, making the dependency self-documenting. |

## Verification performed

**Tests** — `npx jest` on both files:
```
Test Suites: 1 failed, 1 passed, 2 total
Tests:       4 failed, 35 passed, 39 total
```
The split is unchanged and correct: the 4 failures are exactly the `[RED until spec 10-bio-ingest-to-root]` target cases (each failing because the controller still resolves via `getActiveSession` → `NO_SESSION`, never a hang or compile error — `firstNonReadyFrame` captures the error frame cleanly), and all 35 characterization cases (existing auth/pause, batch-consistency smoke, engine lifecycle + overflow density) pass GREEN.

**Lint** — `npx eslint` on both files:
```
biometric-stream-engine.service.spec.ts → 0 problems
module-biometric-stream.grpc.controller.spec.ts → 4 problems (1 error, 3 warnings)
```
The engine spec is fully clean. The controller spec's 4 remaining problems are the **pre-existing baseline** I measured against `HEAD` in review 1 — `23:3` `no-unsafe-return` in `makePausedSession`, and `124–126` constructor `as any` warnings — all on lines this milestone did not author. **The change introduces zero new lint problems.** Cleaning up the pre-existing baseline is not this milestone's responsibility.

## Correctness re-trace (revised code)

I re-checked the revisions for regressions:
- `makeRoot` returns `{ id, activityType: string, isPaused }`; `'root'` satisfies the declared `string` field — no type error.
- `activityEngine.ensureRoot` is now part of `ReturnType<typeof makeActivityEngine>`, so `.mockResolvedValue(makeRoot(...))` type-checks and the per-call casts are gone.
- The overflow samples typed `BioSampleInternal` (`data: string` and `data: {}`) are both accepted by `pushBatch`; the byte math still holds (≈45 B base + ≈990 B oversized > 1000 cap → dropped; ≈48 B trailing fits → accepted), yielding `acceptedCount === 1, droppedCount === 1` via the `continue`-not-`break` path. Confirmed GREEN.
- Forward check: all four RED cases flip GREEN correctly once spec 10 makes `handleBatch` async and resolves via `ensureRoot` — root-match → ack with `root.id`; child id → `SESSION_MISMATCH` (pushBatch not called); null root → `NO_ROOT_SESSION`; paused root → ack. No false-GREEN risk today.
- Test isolation: mocks rebuilt in `beforeEach`; engine `afterEach` shutdown `flushAll` over remaining buffers resolves cleanly (default `repo.save` returns `undefined`, awaited safely) — no unhandled rejection.

## Conclusion

Both review-1 findings are resolved, no new defects, and no findings against the milestone-06 code changes. The tests are logically correct and the RED/GREEN contract holds exactly as the plan intends.

REVIEW_PASS
