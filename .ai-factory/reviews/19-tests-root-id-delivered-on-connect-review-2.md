# Code Review (pass 2) — Tests: root id delivered on connect (milestone 19)

**Reviewed:** `git diff HEAD` / `git status`. Only code change: `src/realtime/module-state.grpc.controller.spec.ts` (remaining diffed files are `.ai-factory/` plan/review docs).
**Plan:** `.ai-factory/plans/19-tests-root-id-delivered-on-connect.md`
**Feature under test:** note 34 (root `isRoot` frame on connect); test spec note 31.
**Prior review:** `.ai-factory/reviews/19-tests-root-id-delivered-on-connect-review-1.md` (2 findings).

## Both prior findings resolved (verified)

**Finding 1 (🟠 Medium) — undrained inline INTERNAL_ERROR test.** Fixed. `module-state.grpc.controller.spec.ts:1153-1154` now drains connect-phase frames immediately after the connect flush and before the command is sent:

```ts
await flushMicrotasks();
// Drain connect-phase frames (mirrors setupRoutingStream) so values[0] is the command response
values.length = 0;
request$.next({ activityEnd: {} });
```

Placement is correct — after setup completes, before `activityEnd`. It is a no-op today (no connect emit) and drops the leading root frame post-feature-34, so `values[0]?.sessionError?.code === 'INTERNAL_ERROR'` (`:1159`) stays stable across the feature transition. The test is GREEN now and will not break when feature 34 lands.

**Finding 2 (🟢 Nit) — inconsistent optional chaining.** Fixed. All 7 `isRoot` cast accesses now use the safe `(… as any)?.isRoot` form (`:175, :216, :303, :325, :375, :382, :411`); a grep for the unsafe `as any).isRoot` form returns nothing.

## Independent verification (this pass)

- **Type-check:** `npx tsc --noEmit` → no errors in the spec file (the only tsc errors remain the pre-existing, untouched `biometric-stream-engine.service.spec.ts`). The `as any` forward-reference for the not-yet-generated `isRoot` field compiles. ✅
- **Test run:** `npx jest src/realtime/module-state.grpc.controller.spec.ts` → **8 failed, 55 passed**. The 8 failures are exactly the intended RED target/inverted reconnect-path tests and nothing else; every characterization / do-not-touch test and the entire command-routing block is GREEN. ✅
- **Full sweep of `values`-collecting sites** (every `next: (v) => values.push(v)` that routes through `trackActivity`):
  - reconnect-path block (`:161-430`) — the milestone's intended targets/inverted tests;
  - `setup error` block (`:466-518`) — rejects at `handleReconnect`, before `ensureRoot`/controller `:154`, so no root frame is emitted; `toHaveLength(1)` + `sessionError` assertions are unaffected post-34;
  - `stream teardown` (`:543`, `setupConnectedStream`) — assert only registry/teardown call order, never `values` content;
  - `command routing` — both collection points drained: `setupRoutingStream` (`:740`) and the one inline test (`:1154`).
  No undrained site that asserts `values` content while routing through `ensureRoot` remains. ✅
- **RED→GREEN correctness post-34** (reasoned against note 34's emission `{ moduleSessionId: root.id, status: ACTIVE, isRoot: true }` at controller `:154`, after the reconnect block, before `request.subscribe`):
  - fresh connect / no-clientSessionId → `[ROOT]`; RESUMED → `[RESUMED, ROOT]`; ABANDONED+clientSessionId → `[ABANDONED, ROOT]`; `(d)` → `[ABANDONED, ROOT, ACTIVE(new-session)]`. All assertions match.
  - "distinguish" test correctly identifies frames by `moduleSessionId` (`root-1` vs `child-1`), not ordering, and asserts `isRoot` true on root / falsy on child — robust to both ACTIVE frames sharing the same status.
  - Flush depth unchanged: `ensureRoot` is already awaited today; feature 34 only adds a synchronous `subscriber.next` after it, so `flushMicrotasks(3)` still reaches GREEN without touching the helper. ✅
- **RULES.md:** no `!` non-null assertions added; new code uses `?.` + `as any` casts. ✅
- **Security / migrations / runtime:** N/A — test-only change, no production code, proto, schema, or migration touched.

## Verdict

The diff faithfully implements the plan, compiles, and produces exactly the intended RED set with no collateral damage. Both review-1 findings are fixed and independently verified, and the full anti-target sweep confirms no remaining latent break for feature 34. No findings.

REVIEW_PASS
