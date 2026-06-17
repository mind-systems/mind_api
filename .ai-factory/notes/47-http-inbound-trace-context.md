# Observability logging — HTTP inbound trace correlation (Phase 35)

**Date:** 2026-06-18
**Source:** `~/projects/observability/.ai-factory/notes/02-integrate-mind-api.md` (DoD #3) + codebase recon + owner confirmation. HTTP counterpart to note 46 (gRPC).

## Key Findings

- mind_api exposes 10 HTTP route handlers across `src/sessions/sessions.controller.ts`, `src/users/controller/auth.rest.controller.ts`, and `src/users/controller/google-callback.controller.ts` (called by mind_web). They carry no trace context today.
- **Middleware, not interceptor**, because middleware runs **earliest** in the Nest HTTP pipeline — before guards and pipes — so guard/validation logs are also bound. (gRPC has no Nest middleware concept, which is why the gRPC side uses an interceptor — note 46.)
- Express `req.headers` is a **plain object** (`Record<string, string | string[]>`), **not** a Web `Headers` instance. Use `objectCarrier`, **not** `headersCarrier` (the latter expects a `Headers`). `traceparent`/`tracestate` are single-valued, so the values are strings.
- SDK API (confirmed against `v0.1.0`): `extract(carrier): Context | undefined` (pure), `objectCarrier(obj): Carrier` (case-insensitive `get`), `runWithContext<T>(ctx, fn): T` (runs `fn` in `ctx`, **restores on exit/throw**).

## Implementation

New file `src/common/middleware/trace-context.middleware.ts`:

```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { extract, objectCarrier, runWithContext } from 'observe-js';

@Injectable()
export class TraceContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const ctx = extract(objectCarrier(req.headers as Record<string, string>));
    if (!ctx) {
      next(); // no inbound traceparent → no trace_id (normal)
      return;
    }
    // runWithContext (NOT bindContext): restores on exit so the ALS context
    // never leaks across requests. next() runs the rest of the pipeline
    // synchronously inside ctx; downstream async continuations inherit it.
    runWithContext(ctx, () => next());
  }
}
```

### Registration — `AppModule`

```ts
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceContextMiddleware).forRoutes('*');
  }
}
```

`AppModule` currently has no `configure` — add the `NestModule` implementation. `forRoutes('*')` covers all HTTP routes; the middleware is a no-op (single `extract` + `next()`) for requests without a `traceparent`, so the global apply is cheap.

## Verification (DoD #3)

A request originating in mind_web produces mind_api logs sharing the caller's `trace_id`: `observe-logs trace <id>` shows both legs. A request with no inbound `traceparent` produces logs with no `trace_id` (correct).

## Guards / honest fallback

- ZERO new log lines; no outward `inject` (mind_api is the chain leaf).
- Use `runWithContext` (restores on exit) — **not** `bindContext`/`enterWith` — so context cannot leak across pooled requests.
- `objectCarrier`, not `headersCarrier` (Express headers are a plain object).
- If per-request binding proves unreliable, drop Phase 35 and keep the Phase 34 sink (shared honest fallback with note 46).
- Depends on Phase 34 (note 45); independent of note 46 (the two surfaces are separate mechanisms).
