# Code Review — Tests: bio ingest bound to root (review 1)

**Scope:** Code changes only (the two Jest spec files). The other staged files (`ROADMAP.md`, note 21, plan/plan-review/json) are planning artifacts, not reviewed for runtime behavior.

**Files with code changes:**
- `src/realtime/module-biometric-stream.grpc.controller.spec.ts` (+193)
- `src/realtime/services/biometric-stream-engine.service.spec.ts` (+80)

## Verification performed

I ran both suites:

```
npx jest src/realtime/module-biometric-stream.grpc.controller.spec.ts \
         src/realtime/services/biometric-stream-engine.service.spec.ts
→ Tests: 4 failed, 35 passed, 39 total
```

The split is **exactly** what the plan's RED/GREEN contract requires, and — critically — every RED fails **for the right reason**, not from a hang, compile error, or wrong-mock artifact:

| Target case (RED until spec 10) | Today's outcome | Why it's a correct RED |
|---|---|---|
| resolve root → `pushBatch(root.id)` | `frame.ack` undefined (controller still emits `NO_SESSION` error) | not a hang — `firstNonReadyFrame` captured the error frame |
| child id → `SESSION_MISMATCH` | got `"NO_SESSION"` | controller still resolves via `getActiveSession` |
| `ensureRoot` null → `NO_ROOT_SESSION` | got `"NO_SESSION"` | same |
| paused root → accept | `frame.ack` undefined | same |

All 35 characterization cases (existing auth/pause blocks, the new batch-consistency smoke, the engine lifecycle/overflow chars) pass GREEN. I independently traced the logic and confirm it is sound:

- `firstNonReadyFrame` has no subscribe-ordering bug: the only frame emitted synchronously during `.subscribe()` is `ready` (skipped via early-return before `sub` is dereferenced); the ack/error frame arrives during `request$.next(batch)`, after `sub` is assigned. No hang risk because an error frame also resolves the promise. It is also forward-compatible with spec 10 making `handleBatch` async (frame simply arrives a microtask later).
- Engine lifecycle chars genuinely exercise the real paths: `onSessionAbandoned`/`onSessionRevoked` save once then clear (follow-up `flush` is a no-op); `onSessionCompleted({sessionId:'child-9'})` hits `doFlush`'s missing-buffer early return (no save) while `root-1` stays intact.
- Overflow density char: with the 1000-byte cap, the first `cardio` sample (~45 B) plus the oversized 950-`x` sample (~990 B) exceeds the cap → dropped; the trailing `emotions` sample (~48 B) still fits → `acceptedCount === 1, droppedCount === 1`. The `continue`-not-`break` guarantee is correctly asserted via counters only (L1). Math verified against the actual config and it passes.

No correctness, security, or race-condition defects found in the test logic. The mocks are reconstructed in `beforeEach`, so there is no cross-test state leakage.

## Findings

### 1. [Medium] New test code is not lint-clean — introduces ~25 ESLint errors, breaks `npm run lint`

`npx eslint` on the two changed files reports **27 problems (27 errors, 4 warnings)**. I confirmed against `HEAD` that both files were essentially clean before this change (1 pre-existing prettier nit each, plus the pre-existing constructor `as any` warnings), so the bulk is **newly introduced**:

**`module-biometric-stream.grpc.controller.spec.ts`**
- `50–60` `makeRoot`: `activityType: 'root' as any` →
  `@typescript-eslint/no-unsafe-assignment` + `@typescript-eslint/no-unnecessary-type-assertion` (the property is typed `string`, so `as any` is both unsafe and unnecessary).
- `337, 361, 381, 398` `(activityEngine as any).ensureRoot.mockResolvedValue(...)` →
  `@typescript-eslint/no-unsafe-call` + `no-unsafe-member-access` (4× each).
- `273–302` several `prettier/prettier` formatting errors (object/arg wrapping).

**`biometric-stream-engine.service.spec.ts`**
- `326–339` `prettier/prettier` formatting (multi-line object/arg wrapping).
- `335` `oversized as any, small as any` → `@typescript-eslint/no-unsafe-argument` (warn) + `no-unnecessary-type-assertion` ×2 (the locally-typed objects already satisfy `BioSampleInternal[]`, so the casts are unnecessary).

**Why this matters:** `npm run lint` is a documented project command (CLAUDE.md), and the *surrounding* engine spec is deliberately kept clean with inline `// eslint-disable-next-line @typescript-eslint/no-unsafe-argument` comments on its constructor `as any` args — i.e. the file's established convention is to suppress these explicitly, which the new code does not follow. This does not affect the test run or the RED/GREEN signal, but it fails the lint gate and is stylistically inconsistent with the file it extends.

**Suggested fix:**
- Run `npm run format` (or `eslint --fix`) — clears all the `prettier/prettier` errors (17 of them are auto-fixable).
- Drop the unnecessary `as any` casts where the receiver already accepts the type: `activityType: 'root'` in `makeRoot`, and `engine.pushBatch('root-1', [oversized, small])` (type the two locals as `BioSampleInternal`).
- For `(activityEngine as any).ensureRoot...`, match the existing file's pattern: either add `// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call`, or — cleaner — type the mock once, e.g. `const ensureRoot = activityEngine.ensureRoot as jest.Mock; ensureRoot.mockResolvedValue(...)`, avoiding the per-call `as any`.

### 2. [Nit] Overflow-density char depends on hard-coded byte sizes

The `'x'.repeat(950)` oversized payload only triggers a drop because `BIO_STREAM_MAX_BUFFER_BYTES` defaults to `1000` in `makeConfig`. This is consistent with the pre-existing `drops samples when per-session byte cap is reached` test (which also uses 950), so it is not a regression — but the assertion is implicitly coupled to that config constant. If a future change raises the default cap, the sample would be accepted and this would flip RED as a false alarm. Optional: stub the cap explicitly in this test (e.g. `makeConfig({ [RealtimeConfig.BIO_STREAM_MAX_BUFFER_BYTES]: 1000 })`) to make the dependency self-documenting.

## Conclusion

The tests are logically correct and the RED/GREEN contract is satisfied exactly as the plan intends — no functional defects. The one actionable item is the lint cleanup (Finding 1); Finding 2 is an optional robustness nit.
