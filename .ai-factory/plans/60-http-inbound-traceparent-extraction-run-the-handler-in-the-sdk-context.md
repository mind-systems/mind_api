# Plan: HTTP inbound `traceparent` extraction — run the handler in the SDK context

## Context
Bind inbound W3C trace context from HTTP request headers so mind_api logs emitted during HTTP handling (sessions, REST auth, Google OAuth callback) share the caller's `trace_id`. Implemented as a Nest middleware that runs earliest in the HTTP pipeline (before guards/pipes), mirroring the gRPC interceptor counterpart (note 46).

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Middleware + registration

- [x] **Task 1: Add `TraceContextMiddleware`**
  Files: `src/common/middleware/trace-context.middleware.ts`
  Create a new `@Injectable()` class implementing `NestMiddleware` from `@nestjs/common`. In `use(req: Request, _res: Response, next: NextFunction): void` (Express types from `express`):
  - Build a carrier with `objectCarrier(req.headers as Record<string, string>)` — use `objectCarrier`, NOT `headersCarrier`, because Express `req.headers` is a plain object (`Record<string, string | string[]>`), not a Web `Headers` instance. `traceparent`/`tracestate` are single-valued, so values are strings.
  - Call `const ctx = extract(carrier)`.
  - If `ctx` is falsy → call `next()` and `return` (no inbound `traceparent` → no `trace_id`, which is the normal case).
  - Otherwise call `runWithContext(ctx, () => next())`. Use `runWithContext` (restores ALS context on exit/throw) — NOT `bindContext`/`enterWith` — so the default context never leaks across pooled requests.
  - Import `extract, objectCarrier, runWithContext` from `'observe-js'` (same import surface already used by `src/grpc/grpc-trace-context.interceptor.ts`).
  - ZERO new log lines; no outward `inject` (mind_api is the trace-chain leaf). The middleware is a single `extract` + `next()` — cheap enough for a global apply.

- [x] **Task 2: Register the middleware globally in `AppModule`** (depends on Task 1)
  Files: `src/app.module.ts`
  - Make `AppModule` implement `NestModule` (import `NestModule`, `MiddlewareConsumer` from `@nestjs/common`).
  - Add `configure(consumer: MiddlewareConsumer): void { consumer.apply(TraceContextMiddleware).forRoutes('*'); }` so the middleware binds context for ALL HTTP routes — guard/validation logs included, because middleware runs before guards and pipes.
  - Import `TraceContextMiddleware` from `./common/middleware/trace-context.middleware`.
  - Leave the existing `GrpcTraceContextInterceptor` provider untouched — gRPC has no Nest middleware concept, so the two surfaces stay independent.

## Notes
- Depends on Phase 34 (note 45, OTLP sink) — already present (`observe-js` wired in `src/main.ts`). Independent of note 46 (gRPC interceptor) — separate mechanism.
- Single logical change set → single commit, no commit plan needed.
