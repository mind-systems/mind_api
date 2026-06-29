# Code Review — Tests: root id delivered on connect (milestone 19)

**Reviewed:** `git diff HEAD` (only code change: `src/realtime/module-state.grpc.controller.spec.ts`; the rest are `.ai-factory/` plan/review docs).
**Plan:** `.ai-factory/plans/19-tests-root-id-delivered-on-connect.md`
**Feature under test:** note 34 (`is_root`/`isRoot` root frame on connect); test spec note 31.

## What I verified empirically

- **Type-check:** `npx tsc --noEmit -p tsconfig.json` produces **no errors in `module-state.grpc.controller.spec.ts`** (the only tsc errors are pre-existing in the unrelated `biometric-stream-engine.service.spec.ts`, untouched by this diff). The `as any` cast strategy for the not-yet-generated `isRoot` field compiles cleanly. ✅
- **Test run:** `npx jest src/realtime/module-state.grpc.controller.spec.ts` → **8 failed, 55 passed**. The 8 failures are *exactly* the intended RED target/inverted tests and nothing else:
  - new targets: "carrying the root id on a fresh connect", "distinguish the root frame from a child by isRoot === true", "announce the root id after the RESUMED frame";
  - inverted: RESUMED (now `[RESUMED, ROOT]`), "fresh connect null emits root frame", "(b) ABANDONED followed by root", "(c) no clientSessionId emits root", "(d) re-indexed to length 3".
  No do-not-touch / characterization test regressed. ✅
- **`isRoot` (not `is_root`):** the diff correctly uses the camelCase runtime key — matches the generated stub (`proto/generated/module_state.ts:99,101` → `moduleSessionId`, `isPaused`) and note 34's emission. Plan-review-1 Issue 1 is properly addressed. ✅
- **No `!` non-null assertions added** (RULES.md). The new lines use `?.` and `as any` casts. ✅
- **Drain in `setupRoutingStream` (`:740`)** correctly neutralizes the whole command-routing block: a no-op today (no connect emit), drops the root frame post-34 so the ~30 `values[0]` routing assertions stay stable. `setupConnectedStream` (`:539`) is correctly left undrained — its tests assert only registry/teardown call order, never `values` content. ✅
- **`setup error` block (`:459`)** rejects at `handleReconnect` (before `ensureRoot`/`:154`), so no root frame is emitted — its `values.toHaveLength(1)` + `sessionError` assertions are unaffected post-34. ✅
- **Flush depth:** feature 34 adds no new `await` — `ensureRoot` is already awaited at controller `:154` today; the root `subscriber.next(...)` is synchronous after it. `flushMicrotasks(3)` already drains past `ensureRoot` (the existing subscribe-ordering test proves it), so the inverted/target tests will reach GREEN post-34 without touching the helper. ✅

## Findings

### 1. 🟠 Medium — One command-routing test bypasses the drain and will break when feature 34 lands

`src/realtime/module-state.grpc.controller.spec.ts:1134-1163` — `it('should keep the outer subscription open after emitting INTERNAL_ERROR ...')`.

Unlike every other test in the `command routing` block, this one does **not** use `setupRoutingStream()` (it needs to capture `completed`/`errored` flags on the subscription), so it builds the stream inline at `:1142` and collects `values` directly — **without the `values.length = 0` drain**:

```ts
const sub = controller.trackActivity(request$, makeUser()).subscribe({ next: (v) => values.push(v), ... });
await flushMicrotasks();                       // :1152 — connect completes here
request$.next({ activityEnd: {} });            // endActivity rejects → INTERNAL_ERROR
await flushMicrotasks();
expect(values[0]?.sessionError?.code).toBe('INTERNAL_ERROR');   // :1157
```

It connects with the default `handleReconnect → null` / `ensureRoot → makeSession()` (id `session-1`) and reaches controller `:154`. **Today** nothing is emitted on connect, so `values[0]` is the INTERNAL_ERROR frame and the test passes. **After feature 34**, the connect emits a leading root frame, so `values` becomes `[ROOT(session-1), INTERNAL_ERROR]` — `values[0]` is now the root `sessionState` frame with no `sessionError`, and `values[0]?.sessionError?.code` is `undefined`. The assertion at `:1157` flips **RED**.

This is the exact latent-break class plan-review-1 Issue 2 raised; the drain fix covered the helper-based routing tests but missed this inline one. It is not a target of this milestone, so it would surface as a surprise regression the moment feature 34 merges — defeating the milestone's clean RED→GREEN handoff for that test (and contradicting note 34's claim that all anti-targets are enumerated/handled).

**Fix (any one):**
- Drain after the connect flush — insert `values.length = 0;` right after `await flushMicrotasks();` at `:1152` (mirrors the helper; stays a no-op today). Preferred — smallest, consistent.
- Or assert against the routed frame regardless of leading frames: `expect(values.find((v) => v.sessionError)?.sessionError?.code).toBe('INTERNAL_ERROR');`.

(For completeness I confirmed the sibling "continue routing after INTERNAL_ERROR" test at `:1165` is safe — it uses the drained `setupRoutingStream`, so its `toHaveLength(2)` / `values[0]` / `values[1]` assertions stay correct post-34.)

### 2. 🟢 Nit — Inconsistent optional chaining on the `isRoot` cast access

Some inverted tests use `(values[1]?.sessionState as any).isRoot` (no `?.` before `.isRoot`, e.g. `:174`, `:301`, `:411`) while the fresh-connect ones use `(values[0]?.sessionState as any)?.isRoot` (e.g. `:213`, `:322`). In the no-`?.` form, if `values[1]` were absent the expression would throw `TypeError` instead of failing the assertion cleanly. In practice it's harmless — the preceding `expect(values).toHaveLength(2)` throws first today, and `values[1]` is defined post-34 — so this is purely stylistic consistency. Recommend the `?.isRoot` form everywhere.

## Verdict

The diff faithfully implements the plan, compiles, and produces exactly the intended RED set with no collateral damage to characterization/do-not-touch tests — the milestone's *immediate* acceptance is met. However, Finding 1 is a genuine latent break: one command-routing test will go RED when feature 34 lands, which is precisely what this milestone exists to prevent. Address Finding 1 (one-line drain) before sign-off; Finding 2 is optional polish.
