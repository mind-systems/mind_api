# Code Review: Tests — concurrent activities + idempotency dedup (review 2)

**Change under review:** new file `src/realtime/concurrency-idempotency.spec.ts` (542 lines, +8 since review 1). No production code changed. The other staged files are plan/note/review artifacts.

**Method:** re-read the spec file in full; re-read `module-state.grpc.controller.ts` (the unit under test); re-confirmed `SessionRevokedPayload = { userId: string }`; **re-ran the suite** (`npx jest src/realtime/concurrency-idempotency.spec.ts`) → **7 failed, 4 passed**, split unchanged and correct (7 RED = all `[TARGET]`, 4 GREEN = all `[CHARACTERIZATION]`); and **simulated the post-spec-06 outcome** of the two fixed tests to confirm their GREEN done-state is now reachable.

## Review-1 findings — both resolved and verified

### Finding 1 (was HIGH) — RESOLVED
`should NOT return an existing session just because one is already active` (lines 266-284) now wires the pre-existing active session as `makeActivityState({ sessionId: 'existing-session' })` (line 271-273) and asserts `.not.toBe('existing-session')` (line 283). `'existing-session'` is outside the `session-N` counter space, so `startActivity`'s first output (`session-1`) no longer collides with the sentinel. Simulation confirms the post-06 assertion now **PASSes** (reachable GREEN):
```
test#2 post-06 created id: session-1
assertion .not.toBe("existing-session"): PASS (reachable GREEN)
```
The test remains RED today for the right reason (guard echoes `existing-session`, `startActivity` not called). Correct.

### Finding 2 (was MEDIUM) — RESOLVED
`should emit sessionError.code === 'AMBIGUOUS_SESSION' …` (lines 480-508) now populates `listLiveSessions` with two children (lines 484-487) alongside `getSoleChild → undefined`, and the inline comment (lines 481-483) explains why: `listLiveSessions().length > 1` is the basis a correct spec-06 impl must use to distinguish ">1 (AMBIGUOUS)" from "0 (NO_SESSION)", rather than treating any missing sole child as ambiguous. The fixture now genuinely represents the ">1 active" condition the title claims. Correct.

## Independent pass — no new defects

- **Compile / runtime:** the file compiles under ts-jest (the run produced assertion failures, not compile errors). `controller.handleSessionRevoked({ userId: 'user-1' })` type-checks against `SessionRevokedPayload`. No DB, network, migration, or production path is touched.
- **RED-for-the-right-reason verified per case:** concurrent-start ×2, within-window dedup, routing ×3, and revoke fan-out all fail today against real current-controller behavior (userId-only handlers, singleton guard, single `stopActivity`) — not on fixture artifacts.
- **GREEN characterization cases** (after-window, per-user scoping, absent-token, teardown-evict) hold today and each still guards a real post-06 obligation (e.g. teardown-evict goes RED post-06 if a leaked token dedups the second connection). The `advanceTimersByTime(10_001)` (window + 1 ms) correctly avoids the `> window` off-by-one.
- **Per-user scoping under fake timers:** both `setupStream` calls drain via `await Promise.resolve()`, which is unaffected by Jest fake timers; the shared `startActivity` counter yields distinct ids (`session-1`/`session-2`). Sound.
- **Observable-only assertion discipline** is maintained throughout — no test reaches into internal token/session maps.

## Informational (no change required)

The two `sessionId`-absent routing tests deliberately exercise different resolution mechanisms — the sole-child case drives `getSoleChild` (with `listLiveSessions` left at its default `[]`), while the ambiguity case drives `listLiveSessions().length > 1` (with `getSoleChild → undefined`). Both are GREEN-reachable **only if** spec 06 resolves the single-child fallback via `getSoleChild()` (per the plan's pinned forward-coupling), not via a `listLiveSessions().length === 1` check — otherwise the sole-child test's empty `listLiveSessions` would misfire. This is consistent with the plan's contract and therefore correct as written; a spec-06 implementer should simply note that `getSoleChild` is the pinned mechanism for the sole-child branch. (Optionally, returning the single child from `listLiveSessions` in the sole-child test too would make the fixture internally consistent and robust to either resolution strategy — but it is not required.)

## Verdict

Both prior findings are fixed and empirically verified; the suite compiles, runs, and produces the intended 7-RED / 4-GREEN split with every target test now having a reachable GREEN done-state. No correctness, security, or runtime defects remain.

REVIEW_PASS
