# Plan: gRPC inbound `traceparent` extraction — run the handler in the SDK context

## Context
Extract the inbound `traceparent` from gRPC call metadata and run each handler inside the `observe-js` ambient context, so the existing `new Logger(...)` lines emitted while serving the RPC inherit the caller's `trace_id`. Zero new log lines, zero call-site changes. Inbound counterpart to the mobile leg that originates the trace.

## Settings
- Testing: no
- Logging: minimal (hard guard: ZERO new log lines)
- Docs: no

## Reconnaissance notes (for the implementer)
- Sibling pattern: `src/grpc/grpc-auth.interceptor.ts` — already reads `context.switchToRpc().getContext<Metadata>()` and `metadata.get('authorization')[0]?.toString()`. Mirror its metadata access.
- `GrpcAuthInterceptor` is **controller-scoped**, applied per controller via `@UseInterceptors(GrpcAuthInterceptor)` (in `breath-sessions`, `stats`, `bci`, `sync`, `realtime/module-state`, and the other gRPC controllers) — it is **not** global.
- NestJS runs **global** interceptors (`APP_INTERCEPTOR`) **before** controller-scoped ones. Registering the new interceptor globally therefore makes it run **outermost** — ahead of every `GrpcAuthInterceptor` — without editing each controller, so even auth-failure logs are emitted inside the active context. This satisfies the milestone's "outermost, before `GrpcAuthInterceptor`" requirement.
- `observe-js` (v0.1.0) exports `extract`, `objectCarrier`, `runWithContext` from the package root (`import { ... } from 'observe-js'`) — confirmed against `node_modules/observe-js/dist/*.d.ts`. `main.ts` already imports `init`/`flush`/`shutdown` from `'observe-js'`. The note's referenced `src/node/context.ts` does **not** exist in this repo — use the package exports directly.
- `AppModule` (`src/app.module.ts`) currently has **no** `providers` array — it must be added to register the global interceptor.
- A global interceptor fires on **every** transport, including HTTP (the hybrid app serves both). On an HTTP context, `switchToRpc().getContext()` returns the Express `Response`, whose `.get()` is a header getter returning `string | undefined` (not an array) — `[0]` on `undefined` throws. The interceptor MUST therefore early-out on non-RPC contexts. HTTP trace binding is handled separately by the sibling milestone (note 47 middleware).

## Tasks

### Phase 1: Implementation

- [x] **Task 1: Create `GrpcTraceContextInterceptor`**
  Files: `src/grpc/grpc-trace-context.interceptor.ts`
  Create a `@Injectable()` class implementing `NestInterceptor` (`intercept(context: ExecutionContext, next: CallHandler): Observable<unknown>`), no constructor dependencies. Import `extract`, `objectCarrier`, `runWithContext` from `'observe-js'`, `Metadata` from `'@grpc/grpc-js'`, `Observable` from `'rxjs'`, and the Nest types from `'@nestjs/common'`. Logic:
  1. **Transport guard (mandatory):** if `context.getType() !== 'rpc'`, `return next.handle()` unwrapped. This prevents the interceptor from touching HTTP requests (where `switchToRpc().getContext()` is the Express `Response`, not `Metadata`).
  2. Read `const md = context.switchToRpc().getContext<Metadata>();` — same accessor as `grpc-auth.interceptor.ts`.
  3. `const ctx = extract(objectCarrier({ traceparent: md.get('traceparent')[0]?.toString() ?? '', tracestate: md.get('tracestate')[0]?.toString() ?? '' }));`
  4. If `ctx` is falsy (no valid inbound `traceparent`), `return next.handle()` unwrapped — logs simply carry no `trace_id` (correct).
  5. Otherwise return a `new Observable((subscriber) => { let sub; runWithContext(ctx, () => { sub = next.handle().subscribe(subscriber); }); return () => sub?.unsubscribe(); })` so the handler is **subscribed inside** `runWithContext` (scoped, restore-on-exit). Deliberately do NOT use `bindContext`/`enterWith` — no restore would leak context across pooled/streaming calls.
  Guards: ZERO new log lines; no outward `inject`; no non-null assertion operator (`!`) — use optional chaining / `?? ''` as above.

- [x] **Task 2: Register the interceptor globally so it runs outermost** (depends on Task 1)
  Files: `src/app.module.ts`
  Add a `providers` array to the `@Module({ ... })` decorator containing `{ provide: APP_INTERCEPTOR, useClass: GrpcTraceContextInterceptor }`. Import `APP_INTERCEPTOR` from `'@nestjs/core'` and `GrpcTraceContextInterceptor` from `'./grpc/grpc-trace-context.interceptor'`. Global registration guarantees it executes before the controller-scoped `GrpcAuthInterceptor` on every gRPC handler, so auth-failure logs also carry `trace_id`. Do not modify any individual controller's `@UseInterceptors` arrays.

### Phase 2: Verification

- [x] **Task 3: Verify ALS propagation across the rxjs subscribe boundary — honest fallback** (depends on Task 2)
  Files: none (validation only)
  Confirm the project builds (`npm run build`) and that the ambient context set in `runWithContext` actually reaches the handler's logger calls across the rxjs `subscribe` boundary, for **both** a unary `@GrpcMethod` handler **and** a streaming `@GrpcStreamMethod` handler. Validate end-to-end: a call carrying an inbound `traceparent` produces mind_api logs stamped with the caller's `trace_id` (e.g. via the `observe-logs trace <id>` tooling against the local Loki sink, with `LOG_DESTINATION=grafana|both`), and a call with no inbound `traceparent` produces logs with no `trace_id`. If ALS does **not** reliably propagate across the rxjs/Nest boundary (especially for streaming handlers), this whole phase is **droppable** per the milestone's honest fallback: revert Tasks 1–2 and keep the Phase 34 OTLP sink as the shipped floor — never add a log line to force correlation.

## Commit Plan
- **Commit 1** (after tasks 1–2): "Add gRPC inbound traceparent extraction interceptor"
- Task 3 is validation only — fold any fixes it surfaces into Commit 1; if verification fails, revert instead of committing.
