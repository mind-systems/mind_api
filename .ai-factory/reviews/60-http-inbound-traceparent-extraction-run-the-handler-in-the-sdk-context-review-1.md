# Code Review: HTTP inbound `traceparent` extraction — run the handler in the SDK context

**Scope reviewed:** `src/common/middleware/trace-context.middleware.ts` (new), `src/app.module.ts` (modified). Plan/JSON/plan-review artifacts are non-code and not reviewed.

**Verdict:** No correctness, security, or runtime-boot issues found. The change is a faithful, minimal mirror of the already-shipped `GrpcTraceContextInterceptor`.

## Runtime-correctness verification

I traced the three things that could break at runtime against the *installed* dependency code, not just by reading the diff:

1. **ALS propagation to async handlers — correct.** `runWithContext(ctx, fn)` resolves to `currentManager.with(ctx, fn)` → `createNodeContextManager().with` → `als.run(ctx, fn)` (`node_modules/observe-js/dist/node.cjs:188, 418-419`). `AsyncLocalStorage.run` snapshots the store onto every async resource created synchronously within `fn`, so even though Express's `next()` returns synchronously while downstream guards/pipes/controller/service continue asynchronously, they all inherit the trace context. The HTTP path is in fact simpler than the gRPC interceptor (no rxjs `subscribe` boundary to bridge). `bindContext`/`enterWith` was correctly avoided — `als.run` auto-restores the prior store on exit, so no cross-request leakage in the pooled Express worker.

2. **`forRoutes('*')` boots on Express 5 — confirmed safe.** Installed `express@5.2.1` + `@nestjs/core@11.1.13`. Express 5's path-to-regexp v8 rejects bare `*`, but Nest 11 intercepts it: `route-info-path-extractor.js:49 isAWildcard` lists `'*'` as a simple wildcard, and `legacy-route-converter.js:37 tryConvert` rewrites `'*'` → `'{*path}'` before it ever reaches path-to-regexp. No bootstrap throw, no deprecation noise.

3. **No mutation of `req.headers`.** `extract` only calls `carrier.get(...)` (`node.cjs:284-293`); `objectCarrier.get` does a case-insensitive read and never writes (`node.cjs:295-308`). `inject`/`set` is never invoked (mind_api is the trace-chain leaf). Request headers are left untouched.

## Robustness / security notes (all non-blocking)

- **Malformed or absent `traceparent` is handled defensively.** `parseTraceparent` (`node.cjs:262-275`) validates version, lowercase-hex trace/span IDs, correct lengths, and non-zero — returning `undefined` on any deviation. The middleware then falls through to `next()`. A garbage or spoofed header therefore yields *no* `trace_id` rather than a 500, and the validated-hex constraint means nothing attacker-controlled is interpolated into log fields. Good.
- **The `as Record<string, string>` cast is accurate in practice.** Node combines duplicate `traceparent`/`tracestate` request headers into a single comma-joined string (these are not in Node's array-preserving header set), so `req.headers.traceparent` is always `string | undefined`. A hypothetical array value would make `parseTraceparent`'s `value.split('-')` throw, but that path is unreachable for these headers — same assumption the gRPC side relies on. Noted for completeness only; no change needed.
- **No new log lines, no PII, no non-null assertion** — complies with `RULES.md` (lean logs, no PII, no `!`).
- **Global scope (incl. `/health`) is negligible cost** — one case-insensitive header scan + `next()` per request when no `traceparent` is present, as the plan states.

## Plan adherence

Both tasks implemented exactly as specified: `objectCarrier` (not `headersCarrier`), `runWithContext` (not `bindContext`/`enterWith`), `forRoutes('*')`, `NestModule.configure`, same `observe-js` import surface as the gRPC interceptor, and the existing `GrpcTraceContextInterceptor` provider left untouched. Middleware is correctly omitted from `providers` (Nest auto-instantiates middleware referenced in `consumer.apply`).

REVIEW_PASS
