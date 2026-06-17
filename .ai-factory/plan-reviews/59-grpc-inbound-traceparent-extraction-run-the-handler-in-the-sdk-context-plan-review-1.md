# Plan Review: gRPC inbound `traceparent` extraction — run the handler in the SDK context

**Plan:** `59-grpc-inbound-traceparent-extraction-run-the-handler-in-the-sdk-context.md`
**Files Reviewed (for verification):** 6
**Risk Level:** 🟢 Low

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** WARN/none. The plan adds a cross-cutting global interceptor in `src/grpc/` and registers it in `AppModule`. This is consistent with the modular-monolith boundary rules — the interceptor has no constructor dependencies and reaches into no module internals. No boundary violation.
- **Rules (`.ai-factory/RULES.md`):** PASS. RULES.md forbids the non-null assertion operator (`!`); the plan explicitly mandates optional chaining / `?? ''` instead (Task 1, Guards). "Keep logs lean" / "ZERO new log lines" is a hard guard in the plan. No conflict.
- **Roadmap (`.ai-factory/ROADMAP.md`):** WARN (non-blocking). This is observability/perf-adjacent work. The plan references a "milestone" requirement, "Phase 34 OTLP sink", and "note 47 middleware", implying roadmap linkage exists, but the plan does not cite an explicit milestone ID/line. Recommend adding the milestone anchor to the commit/plan for traceability. Non-blocking.

## Verification Against Codebase

Every concrete claim in the plan's reconnaissance notes was checked against the repo and holds:

- ✅ `src/grpc/grpc-auth.interceptor.ts` exists and uses exactly `context.switchToRpc().getContext<Metadata>()` + `metadata.get('authorization')[0]?.toString()`. The mirrored accessor in Task 1 is correct.
- ✅ `GrpcAuthInterceptor` is controller-scoped (constructor-injected deps), **not** global. The reasoning that `APP_INTERCEPTOR` runs outermost (before controller-scoped interceptors) is correct for NestJS interceptor ordering.
- ✅ `observe-js` exports `extract`, `objectCarrier`, `runWithContext` from the package root (`dist/node.d.ts` re-exports all three). `extract` returns `Context | undefined` (falsy-check in step 4 is valid). `objectCarrier.get()` is case-insensitive, so the lowercase `traceparent`/`tracestate` keys are correct. `runWithContext` restores context on exit (try/finally) as the plan states; `bindContext` does not (correctly avoided).
- ✅ `main.ts` already imports from `'observe-js'` and `'observe-js/winston'`.
- ✅ `src/app.module.ts` has **no** `providers` array — Task 2's instruction to add one is accurate. `APP_INTERCEPTOR` comes from `@nestjs/core` (correct).
- ✅ `tsconfig.json` has `noImplicitAny: false`, so the untyped `let sub;` in Task 1's snippet compiles cleanly.
- ✅ `src/grpc/grpc-trace-context.interceptor.ts` does not yet exist (no collision).

## Critical Issues

None. The plan is implementable as written and the API surface is confirmed.

## Observations & Minor Suggestions (non-blocking)

1. **Transport guard also protects WebSocket, not just HTTP.** The app runs a WS layer (RealtimeModule). On a WS context `context.getType()` returns `'ws'`, so the `!== 'rpc'` early-out correctly bypasses it there too. The plan only mentions HTTP — worth noting the guard is broader, which is the desired behavior. No change needed.

2. **The "even auth-failure logs carry trace_id" justification is largely moot.** Neither `GrpcAuthInterceptor` nor `GrpcExceptionFilter` emits any log lines today (both only throw/map `RpcException`). The global-registration choice is still the right one — it avoids editing each controller's `@UseInterceptors` array and wraps any *future* downstream logging — but the stated benefit ("auth-failure logs also carry trace_id") has no current log lines to apply to. Keep the global approach; just don't treat that specific claim as load-bearing.

3. **Streaming propagation risk is correctly self-flagged.** `runWithContext` (AsyncLocalStorage `als.run`) only keeps the store active for the synchronous subscribe and async continuations *descended from it*. For `@GrpcStreamMethod`, later inbound messages arrive via fresh socket `data` events that are not descendants of the initial subscribe, so log lines emitted on those later emissions will likely lack `trace_id`. The plan already calls this out in Task 3 and makes the entire phase droppable with an honest revert-to-OTLP-floor fallback — this is the correct framing. No fix required; just ensure Task 3's streaming check is actually exercised, not assumed.

4. **Version string nit.** The plan says `observe-js (v0.1.0)`; the installed `package.json` reports `version: 0.0.0`. Cosmetic — the exports are what matter and they match. Optionally correct the citation.

5. **Optional typing polish.** `let sub;` could be `let sub: Subscription | undefined;` (import `Subscription` from `rxjs`) for clarity, but it is not required given `noImplicitAny: false`.

## Positive Notes

- Strong reconnaissance: the plan explicitly corrected the upstream note's nonexistent `src/node/context.ts` reference and pointed at the real package exports — this saved a wrong-path implementation.
- The transport guard (step 1) preempts the real crash mode (`switchToRpc().getContext()` returning the Express `Response` on HTTP, where `.get()[0]` would throw). Correctly identified and mandated first.
- Scoped `runWithContext` over `bindContext`/`enterWith` is the right call to avoid context leakage across pooled/streaming calls — rationale is sound.
- Honest fallback in Task 3 (revert rather than force correlation with a new log line) respects the ZERO-new-log-lines hard guard.
- No migration is needed and the plan correctly does not invent one (pure interceptor + DI registration).

PLAN_REVIEW_PASS
