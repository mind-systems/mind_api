# Code Review (Round 2): `ActivityEngine.abandonStale(userId, sessionId)`

**Scope reviewed:** `git diff HEAD` — `src/realtime/services/activity-engine.service.ts` (new `abandonStale` method) and `src/realtime/services/activity-engine.service.spec.ts` (now four `abandonStale` tests). Plan/JSON/review docs are non-code, not reviewed for correctness.

**Verification run this round:**
- `npx jest src/realtime/services/activity-engine.service.spec.ts` → **16/16 pass**.
- `npx tsc --noEmit` → **no errors in the changed files** (the only TS errors live in `biometric-stream-engine.service.spec.ts`, untouched by this change).
- `npx eslint` on the two changed files → **2 errors + 3 warnings** (the 2 errors are new — see F1).

## Progress since Round 1

The implementer addressed three of the six round-1 items:
- **Removed the unused `ActivityType` import** from `activity-engine.service.ts` (round-1 F6) — confirmed no remaining references; tsc clean.
- **Added the `!session` / row-not-found test** as case (d) (round-1 F4) — covers the early-return that clears the store with no save/emit.
- **Strengthened the `streamEngine.push` assertions** to check `dataType: SESSION_EVENT` + `event: ABANDONED` (round-1 F5) — but this is exactly what introduced the new lint errors below.

The core method logic is unchanged and still faithfully implements the plan (re-fetch by `sessionId`, already-finalized guard, set `ABANDONED`+`endedAt`, push the marker keyed by `sessionId`, delete the store entry, emit `SessionEvents.ABANDONED`). No migration is involved.

---

## F1 — [Medium] The change introduces 2 ESLint errors → `npm run lint` now fails

The strengthened push assertions nest `expect.objectContaining(...)` inside an object-literal property:

```ts
expect(streamEngine.push).toHaveBeenCalledWith(
  'session-1',
  expect.objectContaining({
    data: expect.objectContaining({   // ← lines 243 and 290
      dataType: StreamDataType.SESSION_EVENT,
      event: StreamSessionEvent.ABANDONED,
    }),
  }),
);
```

`expect.objectContaining(...)` is typed `any`, so assigning it to the `data` property of the outer literal trips `@typescript-eslint/no-unsafe-assignment`, reported at **error** severity:

```
activity-engine.service.spec.ts:243:11  error  Unsafe assignment of an `any` value  @typescript-eslint/no-unsafe-assignment
activity-engine.service.spec.ts:290:11  error  Unsafe assignment of an `any` value  @typescript-eslint/no-unsafe-assignment
```

These are **new** — the round-1 spec had 0 errors (only `any`-cast warnings), and these exact lines are added by this change. `npm run lint` is `eslint "{src,apps,libs,test}/**/*.ts" --fix` with no `--max-warnings`; ESLint exits non-zero on any *error*, and `no-unsafe-assignment` is not auto-fixable. So the lint gate now fails on this branch. (The 3 remaining `no-unsafe-argument` warnings at lines 66/68/69 are pre-existing constructor-mock casts, unchanged.)

**Fix options (test-only, pick one):**
- Flatten the matcher so the inner `objectContaining` isn't assigned to a property — e.g. read the call and assert the field directly:
  ```ts
  const [, pushed] = streamEngine.push.mock.calls.at(-1)!;
  expect(pushed.data).toMatchObject({
    dataType: StreamDataType.SESSION_EVENT,
    event: StreamSessionEvent.ABANDONED,
  });
  ```
- Or keep the nested form and add a scoped `// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment` on each `data:` line (matches how the file already silences `any` in `makeActivitySessionStore`).

Either way, re-run `npm run lint` to confirm the gate is green before merge.

## F2 — [Medium, carried from Round 1] Concurrent double-fire would double-count stats

Unchanged from round 1 and still the most important *substantive* concern for the follow-up watchdog milestone. The already-finalized guard makes a **sequential** double-fire safe (a later call re-fetches, sees a terminal status, returns without emitting). It does **not** make a genuinely concurrent interleave safe: if the watchdog's `abandonStale` and the grace timer's `abandonActivity` both `findOne` → `DISCONNECTED` before either `save`s, both proceed to `save` + `emit SessionEvents.ABANDONED`.

The round-1 plan-review called a double-emit "harmless because the handlers are idempotent" — true for the stream-engine buffer handlers, but **not** for the third consumer: `StatsWorker.onSessionAbandoned` (`src/stats/stats.worker.ts:32`) → `StatsService.finalise` (`src/stats/stats.service.ts:36`), which is **additive with no per-session dedup** (`totalSessions += 1`, `totalDurationSeconds += durationSeconds`, plus a streak bump). A double-emit therefore corrupts user stats.

Not live in *this* milestone (`abandonStale` has no production caller yet — only tests call it), so nothing to change here. But the watchdog milestone that wires this alongside the grace timer should make the terminal transition atomic — e.g. a conditional update
`UPDATE module_sessions SET status='abandoned', "endedAt"=now() WHERE id=$1 AND status IN ('active','disconnected')`
and emit only when exactly one row changed. That collapses the race for both abandon paths.

## F3 — [Low, carried from Round 1] Emit/store-delete trust the `userId` argument instead of `saved.userId`

The row is already fetched, yet the method keys the store delete and the emit payload on the passed `userId` rather than `saved.userId`. `StatsService.finalise` writes `user_stats` for `event.userId`, so a caller that ever passes a mismatched `(userId, sessionId)` pair would finalize stats for the wrong user and leave the real owner's in-memory entry uncleared. Using `saved.userId` would eliminate the mismatch class and make the `userId` parameter purely defensive. Cheap to do when the watchdog is added.

## F4 — [Low, carried from Round 1] Pending reconnect grace timer is not cancelled

For a `DISCONNECTED` row, `handleTransportDisconnect` may have armed a grace timer in `ActivitySessionStore.timers`. `abandonStale` calls `activitySessionStore.delete(userId)` (clears `activityMap` only, not `timers`), so a leftover timer still fires later → `abandonActivity` → bails on `if (!state) return`. Benign today (and is what makes the sequential double-fire safe), but a `cancelGraceTimer(userId)` would be tidier and is worth adding when the watchdog lands.

---

## Summary

Functionally the change is correct and complete for a standalone building block: behavior matches the plan, all 16 tests pass, the touched files are tsc-clean, and there is no schema/migration impact. **F1 is the actionable blocker for this PR** — the new nested-matcher assertions introduce 2 ESLint errors that fail `npm run lint`; flatten them or disable the rule on those lines. **F2** remains the key correctness item to carry into the watchdog milestone (additive stats finalization is not idempotent under a concurrent double-emit). F3–F4 are low-severity robustness items.
