# Code Review: gRPC inbound `traceparent` extraction — run the handler in the SDK context

**Reviewed:** `git diff HEAD` (staged) — `src/grpc/grpc-trace-context.interceptor.ts` (new), `src/app.module.ts` (modified). Plan/JSON artifacts excluded from code review.
**Risk:** 🟢 Low — small, well-scoped, no DB/migration/contract surface.
**Verdict:** No correctness or security bugs. One minor formatting (lint) issue that should be fixed before commit.

## What was verified

The implementation matches the plan and the runtime behavior was traced end-to-end against the installed `observe-js` source (`node_modules/observe-js/dist/core.cjs`), not just the type stubs:

- **API signatures correct.** `extract(carrier): Context | undefined`, `objectCarrier(obj: Record<string,string>): Carrier`, `runWithContext<T>(ctx, fn): T` — all confirmed against `core.d.ts`/`core.cjs`. Imports resolve from the package root, consistent with `main.ts`.
- **No-traceparent path is safe (the important one).** For a call with no `traceparent` metadata, `md.get('traceparent')[0]` is `undefined` → `?? ''` yields `''`. `objectCarrier.get('traceparent')` then returns `''` (the key exists), `extract` calls `parseTraceparent('')` → `''.split('-')` has length 1 ≠ 4 → returns `undefined` → `extract` returns `undefined` → `if (!ctx) return next.handle()`. So absent/empty traceparent never produces a bogus or zero `trace_id`. Correct.
- **Transport guard prevents the real crash mode.** `context.getType() !== 'rpc'` early-out runs *before* `switchToRpc()`, so HTTP requests (where `switchToRpc().getContext()` is the Express `Response`, whose `.get()` returns `string | undefined`, not an array) and WS contexts are pure pass-throughs. No behavior change on those transports.
- **ALS propagates to async unary handlers.** Because the interceptor is global (`APP_INTERCEPTOR`) it runs outermost; `next.handle()` is invoked *inside* `runWithContext`, so the downstream `GrpcAuthInterceptor.intercept()` and the handler are subscribed within the active context. Even though `runWithContext` returns synchronously, any async continuation scheduled within its callback (the auth interceptor's `await verifyAsync`, the handler's awaits) inherits the store per AsyncLocalStorage semantics. Unary handlers get `trace_id`. This is the intended design.
- **`runWithContext` (not `bindContext`) is correctly chosen** — `core.cjs` shows `runWithContext` restores via try/finally, `bindContext` does not. Scoped restore avoids context leakage across pooled/streaming calls.
- **Teardown is safe.** `sub` is assigned synchronously by `subscribe`; the returned teardown `() => sub?.unsubscribe()` is idempotent (RxJS `closed` guard) even when the source completes/errors synchronously or when the passed `Subscriber` is its own returned subscription.
- **Build passes.** `nest build` (tsconfig.build.json, excludes specs) compiles cleanly. The `tsc --noEmit` errors observed are all in `src/realtime/services/biometric-stream-engine.service.spec.ts` (a `BioSessionSample` cast issue, Phase 32 area) — pre-existing and unrelated to this change.
- **`ReturnType<Observable<unknown>['subscribe']>` resolves to `Subscription`** and compiles under the repo's `noImplicitAny: false`.

## Findings

### Minor

1. **Prettier/lint violations — would fail `npm run lint` (eslint) in CI.** Both changed files trip `prettier/prettier`:
   - `src/grpc/grpc-trace-context.interceptor.ts:1` — single-line multi-name import should be wrapped one-per-line (the sibling `grpc-auth.interceptor.ts` uses the wrapped form; match it).
   - `src/app.module.ts:54` — the `providers` array element should be wrapped onto its own line with a trailing comma.

   Auto-fixable: run `npm run format` (or `npm run lint`, which runs eslint `--fix`). Purely cosmetic, no runtime effect, but the code as staged is not formatted to project style.

## Observations (non-blocking — no action required)

- **Streaming propagation is a known limitation, already self-flagged.** For `@GrpcStreamMethod`, log lines emitted on *later* inbound messages arrive via fresh socket `data` events that are not async-descendants of the initial subscribe, so they will likely lack `trace_id`. Plan Task 3 calls this out and makes the whole phase droppable (honest revert-to-OTLP-floor) rather than forcing correlation with a new log line. Correct framing — just ensure Task 3's streaming check is actually exercised before claiming streaming coverage.
- **The "auth-failure logs carry trace_id" justification is currently moot.** Neither `GrpcAuthInterceptor` nor `GrpcExceptionFilter` emits any log line today (they only throw/map `RpcException`). Global registration is still the right call (covers all 11 handlers without editing each `@UseInterceptors` array, and wraps any future downstream logging), but that specific stated benefit has no current log lines to apply to.
- **`APP_INTERCEPTOR` does apply to gRPC microservice handlers** in this hybrid app (DI-bound globals reach microservice contexts, unlike `app.useGlobalInterceptors()`), and global interceptors run before controller-scoped ones — so the "outermost, before `GrpcAuthInterceptor`" requirement holds.
- **Version-string nit (in the plan, not code):** plan cites `observe-js (v0.1.0)`; installed `package.json` reports `0.0.0`. Cosmetic.

## Conclusion

The change is correct, safe, and faithful to the plan. No bugs, no security issues, no migration/contract risk. Recommend running `npm run format` to clear the two prettier violations before committing; nothing else blocks merge.
