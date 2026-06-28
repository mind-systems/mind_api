# Code Review: Tests — concurrent activities + idempotency dedup (review 1)

**Change under review:** new file `src/realtime/concurrency-idempotency.spec.ts` (534 lines). No production code changed — this is the TDD test contract for the upcoming specs 05/06. The other staged files are plan/note/review artifacts.

**Method:** read the spec file in full, read `module-state.grpc.controller.ts` in full (the unit under test), confirmed `SessionRevokedPayload = { userId: string }`, and **ran the suite** (`npx jest src/realtime/concurrency-idempotency.spec.ts`). Result: **7 failed, 4 passed** — and the split is exactly correct: the 7 RED are all `[TARGET]`, the 4 GREEN are all `[CHARACTERIZATION]`. The harness, builders, key-aware config mock, fake-timer scoping, and observable-only assertions are all sound and match the sibling spec conventions.

The file is in good shape. Two findings below are about cases that are RED today **for the right reason** but whose GREEN done-state is **unreachable / mis-targeted** under a correct spec-06 implementation — so they would never flip to GREEN when the feature lands, contradicting the suite's own "red-for-the-right-reason, green-when-06-lands" contract.

---

## Finding 1 — HIGH: test #2 can never reach GREEN — sentinel id `'session-1'` collides with `startActivity`'s first output

**Location:** `concurrency-idempotency.spec.ts:266-282` — `should NOT return an existing session just because one is already active`.

The "already active" session is wired as `makeActivityState({ sessionId: 'session-1' })` (line 269-271) and the post-06 assertion is `expect(values[0].sessionState?.moduleSessionId).not.toBe('session-1')` (line 281).

But `makeActivityEngine().startActivity` is a counter that yields `session-1`, `session-2`, … (lines 64-67). After spec 06 removes the singleton guard, this test's single `activity:start` calls `startActivity` for the **first** time on a fresh engine → it returns `id: 'session-1'` — the *same string* as the existing-active sentinel. So the assertion `.not.toBe('session-1')` fails **even when the feature is implemented correctly**.

Verified by simulation:
```
created id after spec06: session-1
assertion .not.toBe("session-1") would FAIL (test can never go GREEN)
```

Today it is RED for the right reason (guard echoes `session-1`, `startActivity` not called) — but its done-state is unreachable, so a spec-06 implementer who correctly removes the guard will still see this test RED and may wrongly conclude the feature is broken (or "fix" the test under pressure).

**Fix:** give the pre-existing active session a sentinel that cannot collide with the `session-N` counter space, and assert against that:
```ts
activityEngine.getActiveSession.mockReturnValue(
  makeActivityState({ sessionId: 'existing-session' }),
);
// …
expect(values[0].sessionState?.moduleSessionId).not.toBe('existing-session');
```
(Test #1 at lines 241-264 is **not** affected — it compares the two *created* ids to each other, not to the sentinel — but consider the same `'existing-session'` sentinel there too for clarity.)

---

## Finding 2 — MEDIUM: `AMBIGUOUS_SESSION` test under-specifies the ambiguous condition — risks RED-for-wrong-reason or green-lighting a buggy impl

**Location:** `concurrency-idempotency.spec.ts:478-500` — `should emit sessionError.code === 'AMBIGUOUS_SESSION' when sessionId is absent and >1 child is active`.

The test sets only `getSoleChild → undefined` (line 480) and pushes `activityPause()` with no `sessionId`. It leaves `listLiveSessions` at its default `[]` (line 74) — i.e. **zero** live children.

Per the plan's own forward-coupling contract, `getSoleChild(userId)` returns "the one live child **or `undefined`**" — which conflates *zero children* with *many children*. The only signal that can distinguish "0 → `NO_SESSION`" from ">1 → `AMBIGUOUS_SESSION`" is `listLiveSessions().length`. With `listLiveSessions` returning `[]`, a **correct** spec-06 implementation (one that emits `NO_SESSION`/`NO_ACTIVE_SESSION` when there are no children and `AMBIGUOUS_SESSION` only when `>1`) would emit `NO_SESSION` here — leaving this TARGET test RED for the wrong reason after the feature lands.

Conversely, the only implementation that makes this test GREEN as written is `if (!getSoleChild()) emit AMBIGUOUS_SESSION` — which is itself a **bug** (it reports ambiguity even when the user has zero active sessions). The test, as written, would drive the implementer toward that bug — exactly the silent-failure the suite exists to prevent. The test title literally says ">1 child is active", but the fixtures never establish >1 active child.

**Fix:** make the fixture represent the condition the title claims — populate `listLiveSessions` with ≥2 children so the implementation has a basis to detect ambiguity:
```ts
(activityEngine as any).listLiveSessions.mockReturnValue([
  { sessionId: 'session-A', activityType: 'breath' },
  { sessionId: 'session-B', activityType: 'breath' },
]);
(activityEngine as any).getSoleChild.mockReturnValue(undefined);
```
Consider also adding a sibling case (0 active children, `sessionId` absent) asserting `NO_SESSION`/`NO_ACTIVE_SESSION` — to pin the boundary that distinguishes the two and prevent the "any missing sole child ⇒ ambiguous" bug. This boundary, and the fact that `getSoleChild` cannot itself distinguish 0 from many, should also be recorded in the plan's forward-coupling section so spec 06 implements the count-based branch.

---

## Minor / informational (no change required)

- **`getSoleChild` 0-vs-many ambiguity is the root cause of Finding 2.** The forward-coupling section pins `getSoleChild → child | undefined` but does not pin how ambiguity (>1) is distinguished from emptiness (0). Recommend the plan state explicitly that spec 06 resolves ambiguity via `listLiveSessions().length > 1`, so the two specs do not drift.
- **"After window" case (lines 320-343) is labelled CHARACTERIZATION** but window-expiry is genuinely new spec-06 behavior; today it is GREEN only because no dedup exists at all (two starts → two sessions). This was already acknowledged across the plan reviews and is acceptable — the `advanceTimersByTime(10_001)` (window + 1 ms, avoiding the `> window` off-by-one) is correctly chosen. No action.
- **Teardown-evict case (lines 386-410)** correctly catches a *missing* eviction post-06 (a leaked token would dedup the second connection → `startActivity` called once → RED), so it is a real guard, not a no-op. Good.
- **Revoke fan-out (lines 510-532)** is RED today for the right reason (`stopActivity` called once, asserts 3) and its `closeAll` arm already holds today — clean. `controller.handleSessionRevoked({ userId: 'user-1' })` compiles since `SessionRevokedPayload` is `{ userId: string }`. Good.
- No security or runtime-safety concerns: this is an isolated unit-test file with mocked collaborators; no DB, network, migration, or production code path is touched.

---

## Verdict

Strong, well-targeted suite that empirically RED/GREEN-splits exactly as designed. **Two fixture defects must be fixed before this is the intended TDD contract:** Finding 1 (HIGH) makes a target test impossible to satisfy even with a correct feature; Finding 2 (MEDIUM) under-specifies the ambiguous condition and would either fail-for-the-wrong-reason or green-light a buggy `AMBIGUOUS_SESSION` implementation. Address both, then re-run to confirm the same 7-RED / 4-GREEN split (with the two fixed tests still RED-for-the-right-reason today).
