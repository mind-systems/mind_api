# Plan Review 2: Reconnect resolves session by client-presented id → confirms abandonment

**Plan:** `79-reconnect-resolves-session-by-client-presented-id-confirms-abandonment.md`
**Files Reviewed:** plan + `activity-engine.service.ts`, `module-state.grpc.controller.ts`, `grpc-auth.constants.ts`, `grpc-current-user.decorator.ts`, `grpc-auth.interceptor.ts`, `enums/session-status.enum.ts`, `proto/generated/module_state.ts`, both spec files, plus plan-review-1.
**Risk Level:** 🟢 Low — both blocking issues from review 1 are resolved; codebase references re-verified accurate.

## Resolution of review-1 blockers

- **Issue 1 (non-compiling intermediate commit) — RESOLVED.** Phase 2 now explicitly bundles Tasks 3–5 as "one atomic change … must land in the same commit," and the Commit Plan folds the engine signature widening (Task 3) and the controller branch (Tasks 4–5) into **Commit 2**. No intermediate tree leaves `session.id` accessed on the `{ abandoned: true }` arm. ✅
- **Issue 2 (`moduleSessionId: string | undefined` type error) — RESOLVED.** Task 5 now mandates narrowing `clientSessionId` to a provable `string` before the emit and explicitly forbids the `?? ''` papering-over. ✅
- **Notes 3–5 — INCORPORATED.** Task 1 now carries the Symbol-vs-wire-key warning; the Pre-work section adds the DISCONNECTED/orphaned-row scope confirmation against `session-lifecycle.md`; Task 6(e) requires asserting `findOne`'s `where` contains **both** `id` and `userId`. ✅

## Re-verification of plan assumptions (all confirmed at HEAD)

- `handleReconnect(userId): Promise<ModuleSession | null>` at `activity-engine.service.ts:431-435`, silent null branch, no `recentlyAbandoned`. ✅
- `repo` injected at `:26-28`; `findOne({ where: { id } })` precedent at `:115`, `:189`, `:230`, `:293`, `:409`. ✅
- Controller `setup()` calls `handleReconnect(userId)` at `:107`, `if (subscriber.closed) return` at `:108`, single `if (session)` RESUMED emit at `:110-121`, `connectedAt = Date.now()` at `:123`, command subscription at `:125-145`. ✅
- `SessionStatus.ABANDONED = 'abandoned'` (string enum) in `enums/session-status.enum.ts`. ✅
- Proto `ActivityStatus.ABANDONED = 4`, `RESUMED = 6`; `SessionState.moduleSessionId` is a required `string` (`module_state.ts:33-40, 81`). `ActivityStatus` already imported in the controller at `:18`. ✅
- `GrpcCurrentUser` is a `createParamDecorator` reading `ctx.switchToRpc().getContext<Metadata>()` and casting via `(metadata as any)[SYMBOL]`. The interceptor reads wire keys via `metadata.get('authorization')[0]?.toString()` on the same live `@grpc/grpc-js` `Metadata` object — so `metadata.get('module-session-id')[0]?.toString()` (Task 2) is the correct mechanism. ✅
- `grpc-auth.constants.ts` holds `GRPC_USER_KEY`/`GRPC_TOKEN_KEY` as `Symbol`s and `GRPC_OPTIONAL_AUTH_KEY` as a plain string — co-locating the new string key is consistent. ✅
- Controller spec calls `controller.trackActivity(request$, user)` positionally (`:106, 133, 154, …`) and mocks `handleReconnect`; a third positional `clientSessionId` arg is backward-compatible with existing two-arg calls. ✅

## Context Gates

- **Architecture:** WARN — none. Modular-monolith boundaries respected: the engine resolves via its own `@InjectRepository(ModuleSession)` repo; the controller only maps transport. No cross-module entity injection.
- **Rules:** Aligned. Task 4 preserves `@Payload()` alongside `@GrpcCurrentUser()` and the new `@GrpcMetadataValue(...)` — required because adding a third param decorator keeps the method in explicit-injection mode. Logging stays via `Logger` (Task 3 adds a single `logger.log` on the abandoned branch only). No `console.*`.
- **Roadmap:** WARN — this realtime reconnect milestone is not represented as an explicit `[ ]` line in the current ROADMAP. Non-blocking for a plan review; worth confirming the milestone is tracked.
- **Migrations:** None required and none introduced — the change is read-only against the existing `module_sessions` schema (`SessionStatus` enum already includes `ABANDONED`). Correct.

## Notes / Non-blocking

### A. Task 5's example narrowing guard aborts `setup()` in its (unreachable) failure path
Task 5 suggests `if (!clientSessionId) return;` "immediately before the emit." A bare `return` exits `setup()` entirely, which would skip `connectedAt = Date.now()` and the command subscription (`:123-145`) — contradicting the same task's "the command subscription must proceed." In practice this branch is **unreachable**: the engine only returns `{ abandoned: true }` via path 2, which requires a non-empty `clientSessionId`, so the guard never fires and the stream still opens. The plan is therefore functionally correct. For robustness and to avoid a future reader copying a setup-aborting `return`, prefer a non-returning narrowing local scoped to the branch, e.g.:

```ts
} else if ('abandoned' in result) {
  const abandonedId = clientSessionId; // provably string on this path
  if (abandonedId) {
    subscriber.next({ sessionState: { moduleSessionId: abandonedId, status: ActivityStatus.ABANDONED } });
    this.logger.log(`Session abandonment confirmed on reconnect: userId=${userId} sessionId=${abandonedId}`);
  }
}
// connectedAt + command subscription continue unconditionally
```

This keeps the stream-stays-open guarantee structurally explicit rather than relying on the branch being unreachable. Advisory only — the plan's stated intent is already correct.

### B. Test (d) in Task 7 depends on the mocked engine permitting a follow-up `activityStart`
The "stream stays open after abandoned" case relies on `getActiveSession` returning `undefined` and `startActivity` resolving a session after the abandoned emit — consistent with the existing `makeActivityEngine()` mock defaults. No change needed; just confirming the assertion is satisfiable with the current mock shape.

## Positive Notes

- Resolution order is explicit, flag-free, and keeps grace/watchdog (`abandonActivity`/`abandonStale`) as the sole writers of the DB `ABANDONED` row — no resurrection, no auto-create.
- The DB-`SessionStatus.ABANDONED` vs proto-`ActivityStatus.ABANDONED` enum trap is called out in Task 3.
- `userId`-scoped `findOne` prevents cross-user session-id resolution; Task 6(e) locks the scoping in with an assertion so it cannot regress.
- Commit plan now compiles at every commit, addressing the prior CI-per-commit breakage cleanly.
- Test coverage spans all five engine branches and four controller branches, including the stream-stays-open path.

Both prior blocking issues are resolved and no new blocking issues were found. Notes A–B are advisory.

PLAN_REVIEW_PASS
