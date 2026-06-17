# Plan Review: HTTP inbound `traceparent` extraction

**Plan:** `60-http-inbound-traceparent-extraction-run-the-handler-in-the-sdk-context.md`
**Risk Level:** 🟢 Low
**Verdict:** Solid — technically accurate against the live codebase and dependency versions.

## Context Gates

- **Architecture (`ARCHITECTURE.md`)** — ✅ PASS. The new `TraceContextMiddleware` lives under `src/common/middleware/` (cross-cutting infra, not a feature module's internals). It depends on no other module, so the modular-monolith boundary rules are respected. Registering it in `AppModule.configure()` is the canonical Nest location for global middleware.
- **Rules (`RULES.md`)** — ✅ PASS. No non-null assertion (`!`) is used — the plan uses a type cast (`req.headers as Record<string, string>`), which is allowed. "ZERO new log lines" honors the *Keep logs lean* / *Never log sensitive data* rules (header values, which could carry PII-adjacent data, are never logged).
- **Roadmap (`ROADMAP.md`)** — ✅ PASS / linked. The task is **Phase 35, line 201** ("HTTP inbound `traceparent` extraction"), spec note 47. File path, mechanism (`objectCarrier` not `headersCarrier`, `runWithContext` not `bindContext`, `forRoutes('*')`), and the "no inbound traceparent → no trace_id is correct" semantics all match the roadmap item verbatim. The gRPC counterpart (Phase 35, line 199 / note 46) is already `[x]` done.

## Verification performed

I checked the plan's load-bearing assumptions against the installed code, not just by reading:

1. **`observe-js` import surface** — `extract`, `objectCarrier`, `runWithContext` are all exported from the package root (`node_modules/observe-js/dist/node.d.ts`), same surface `grpc-trace-context.interceptor.ts` already imports. ✅
2. **`objectCarrier` semantics** — `get()` does a case-insensitive key scan; `extract()` reads only `traceparent` + `tracestate`. Passing the entire `req.headers` object is therefore safe: no other keys are touched, and `extract` never calls `set()`, so `req.headers` is **not** mutated. ✅
3. **`runWithContext(ctx, () => next())` signature** — `runWithContext<T>(ctx, fn)` restores the previous context on exit/throw (try/finally in the node context manager). Correct choice over `bindContext` to avoid cross-request ALS leakage in the pooled Express worker. ✅
4. **`forRoutes('*')` on NestJS 11 + Express 5** — this was my main concern, since Express 5 / path-to-regexp v8 rejects unnamed wildcards. **Confirmed safe**: Nest 11's `RouteInfoPathExtractor.isAWildcard` special-cases `'*'`, and the platform-express `createMiddlewareFactory` runs the path through `LegacyRouteConverter.tryConvert`, which converts `/*` → `/{*path}` and **suppresses the deprecation warning** for the "all" wildcard. So `forRoutes('*')` works with no error and no console noise on the installed `@nestjs/core@11.1.13` + `express@5.2.1`. ✅
5. **ALS propagation middleware → guards/pipes/controller** — this is the established `nestjs-cls` pattern (call `next()` inside `als.run()`); the async store set in the middleware propagates to all downstream handlers spawned synchronously within `next()`. The HTTP path is actually *simpler* than the already-shipped gRPC interceptor (no rxjs `subscribe` boundary to cross). ✅
6. **Express type imports** — `@types/express` is installed and `Request`/`Response`/`NextFunction` imports are already used elsewhere (`google-callback.controller.ts`). ✅
7. **Middleware DI registration** — middleware referenced in `consumer.apply()` is auto-instantiated by Nest's middleware container; it does **not** need to be added to `providers`. The plan correctly omits it. ✅

## Critical Issues

None.

## Observations (non-blocking)

- **WARN — no verification step for the droppable gate.** ROADMAP line 197 explicitly flags this phase as *"Droppable: if per-request ALS binding proves unreliable across the rxjs/Nest boundary, drop this phase"*, and note 46 demanded "verify ALS propagates across the boundary." The plan sets `Testing: no` and adds no manual check. Given the gRPC counterpart already proved `observe-js`'s `nodeContextManager` works (and the HTTP path has no rxjs boundary), risk is low — but I'd add one lightweight manual acceptance step to the plan: *send an HTTP request with a `traceparent` header, confirm the request's `Logger` lines in the OTLP/Loki sink carry the matching `trace_id`; send one without the header, confirm no `trace_id` is stamped.* This closes the explicit gate the roadmap set, at near-zero cost.
- **INFO — `forRoutes('*')` also wraps `/health`.** Every health-check hit runs one `extract` + `next()`. The plan already calls this out as "cheap enough for a global apply," and the cost is a single case-insensitive header scan — negligible. No change needed; noted for completeness.
- **INFO — middleware vs. `app.use(helmet())` ordering.** Nest `configure()` middleware and the global `app.use(helmet())` in `main.ts` are independent chains; trace binding does not depend on their relative order. No action.

## Positive Notes

- The plan deliberately mirrors the already-shipped `GrpcTraceContextInterceptor` (same import surface, same `extract → if-null-skip → runWithContext` shape, same restore-on-exit rationale), which keeps the two trace surfaces consistent and easy to reason about.
- The `objectCarrier` vs `headersCarrier` distinction is correctly identified and justified (Express `req.headers` is a plain object, not a Web `Headers`) — a genuinely easy mistake the plan preempts.
- Correct scoping: HTTP-only via middleware, gRPC untouched, no outward `inject` (mind_api is the trace-chain leaf). The "no inbound traceparent → no trace_id is the normal, correct case" framing matches the W3C trace-context intent.
- Single-commit scope is appropriate for this self-contained, two-file change.

PLAN_REVIEW_PASS
