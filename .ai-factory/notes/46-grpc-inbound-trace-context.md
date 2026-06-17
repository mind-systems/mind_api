# Observability logging — gRPC inbound trace correlation (Phase 35)

**Date:** 2026-06-18
**Source:** `~/projects/observability/.ai-factory/notes/02-integrate-mind-api.md` (DoD #3) + codebase recon + owner confirmation. Inbound counterpart to mind_mobile note 112/113.

## Key Findings

- mind_api is the **receiving leg**. mind_mobile (gRPC) mints a root span per call and injects `traceparent` into the call metadata (its notes 112/113). mind_api's job is to **extract** that inbound `traceparent` and run the handler inside the SDK ambient context so the **existing** `new Logger(...)` lines emitted during the RPC inherit the caller's `trace_id`.
- 11 gRPC handlers (`@GrpcMethod`/`@GrpcStreamMethod`) across `realtime/`, `bci/`, `meditation-poses/`, `users/`, `breath-sessions/`, `sessions/`. The existing `src/grpc/grpc-auth.interceptor.ts` is the sibling pattern — it already reads `context.switchToRpc().getContext<Metadata>()` and `metadata.get('authorization')`.
- Node context is `AsyncLocalStorage` (`src/node/context.ts`). Relevant SDK API (confirmed against `v0.1.0`):
  - `extract(carrier: Carrier): Context | undefined` — pure, does **not** bind ambient context; returns `undefined` when no valid `traceparent` is present.
  - `objectCarrier(obj: Record<string,string>): Carrier` — case-insensitive `get`.
  - `runWithContext<T>(ctx, fn): T` — runs `fn` in `ctx`, restores on exit/throw. **The mechanism used here** (and in note 47), for one consistent pattern across both inbound surfaces.
  - `bindContext(ctx): void` — `enterWith`-style; binds for the rest of the current async scope, **no** restore. Available, but **not used**: no restore means it can leak across pooled/streaming calls (the same reason note 47 forbids it on HTTP).
- **No outward `inject`.** mind_api is the leaf of the chain. Revisit only if it is found to call another observed service.

## Implementation

New file `src/grpc/grpc-trace-context.interceptor.ts`. Subscribe to the handler **inside** `runWithContext` — the same scoped, restore-on-exit pattern as the HTTP middleware (note 47). Deliberately **not** `bindContext`/`enterWith`: enterWith does not restore on exit, so it can leak the context across pooled/streaming calls — exactly the leak note 47 forbids on the HTTP side. One pattern across both inbound surfaces.

```ts
import {
  CallHandler, ExecutionContext, Injectable, NestInterceptor,
} from '@nestjs/common';
import { Metadata } from '@grpc/grpc-js';
import { Observable } from 'rxjs';
import { extract, objectCarrier, runWithContext } from 'observe-js';

@Injectable()
export class GrpcTraceContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const md = context.switchToRpc().getContext<Metadata>();
    const ctx = extract(
      objectCarrier({
        traceparent: md.get('traceparent')[0]?.toString() ?? '',
        tracestate: md.get('tracestate')[0]?.toString() ?? '',
      }),
    );
    if (!ctx) return next.handle(); // no inbound traceparent → no trace_id (normal)

    // Subscribe INSIDE runWithContext so the handler's synchronous logger.*
    // calls (and their awaited continuations) read ctx; runWithContext restores
    // on exit — no leak across pooled or streaming calls.
    return new Observable((subscriber) => {
      let sub: { unsubscribe(): void } | undefined;
      runWithContext(ctx, () => {
        sub = next.handle().subscribe(subscriber);
      });
      return () => sub?.unsubscribe();
    });
  }
}
```

### Registration

Register globally so every gRPC handler is covered and so it runs **outermost** — before `GrpcAuthInterceptor` — so auth-failure logs also carry `trace_id`. Either `APP_INTERCEPTOR` ordering (this provider listed before the auth interceptor) or add it to the same `@UseInterceptors([...])` arrays ahead of `GrpcAuthInterceptor`. Confirm the effective order at implementation time (NestJS applies global interceptors before controller-scoped ones; mixed registration needs checking).

## Verification (DoD #3)

A request originating in mind_mobile produces mind_api logs sharing the caller's `trace_id`: `observe-logs trace <id>` shows both legs. A direct call with no inbound `traceparent` produces mind_api logs with no `trace_id` (correct).

## Guards / honest fallback

- ZERO new log lines; no outward `inject`.
- **Verify ALS propagates across the rxjs subscribe boundary** for both unary and streaming handlers. If per-request binding proves unreliable, **drop Phase 35** and keep the Phase 34 sink as the shipped floor — never add a log line to force correlation.
- Confirm `extract` / `objectCarrier` / `bindContext` / `runWithContext` signatures against the installed `v0.1.0` package before wiring.
- Depends on Phase 34 (note 45).
