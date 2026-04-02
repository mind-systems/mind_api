# gRPC Controller: `request` undefined when using `@GrpcOptionalAuth()` + `@GrpcCurrentUser()`

**Date:** 2026-04-02
**Source:** conversation context

## Key Findings

- When a gRPC controller method has a custom param decorator (`@GrpcCurrentUser()`) on any parameter, NestJS switches from default argument passing to explicit parameter injection mode — and any parameter **without** a decorator gets `undefined`.
- This only manifested on methods with `@GrpcOptionalAuth()` because required-auth methods throw `UNAUTHENTICATED` in the interceptor before the method body is ever reached, masking the bug.
- Fix: add `@Payload()` to the `request` parameter on every method that combines `@GrpcCurrentUser()` with `@GrpcOptionalAuth()`.

## Details

### Root Cause

NestJS `RpcContextCreator` reads `PARAM_ARGS_METADATA` from the method. If **any** parameter has a decorator (e.g. `@GrpcCurrentUser()`), this metadata is non-empty and NestJS fills only the registered positions. Positions without a decorator are never filled — they stay `undefined`.

Without custom decorators, NestJS falls back to `DEFAULT_GRPC_CALLBACK_METADATA`:
```js
{ "PAYLOAD:0": { index: 0 }, "CONTEXT:1": { index: 1 }, "GRPC_CALL:2": { index: 2 } }
```
This default is **skipped** as soon as `PARAM_ARGS_METADATA` is non-empty.

### Why Only `@GrpcOptionalAuth()` methods Were Affected

All controller methods have `@GrpcCurrentUser()`, so all have non-empty `PARAM_ARGS_METADATA`. However:

- **Required-auth methods** (`createSession`, `updateSession`, etc.): `GrpcAuthInterceptor` throws `UNAUTHENTICATED` before the method body runs → `request.page` is never accessed → no crash.
- **Optional-auth methods** (`listSessions`, `batchGetSessions`, `getSession`): interceptor allows the call through → method body runs → `request` is `undefined` → `TypeError`.

### Affected Methods (all with `@GrpcOptionalAuth()`)

| Method | File |
|---|---|
| `listSessions` | `breath-sessions.grpc.controller.ts:75` |
| `batchGetSessions` | `breath-sessions.grpc.controller.ts:111` |
| `getSession` | `breath-sessions.grpc.controller.ts:129` |

### Fix Applied

Added `@Payload()` decorator to the `request` parameter on all three methods:

```typescript
// Before
async listSessions(
  request: ListSessionsRequest,
  @GrpcCurrentUser() user?: JwtPayload | null,
)

// After
async listSessions(
  @Payload() request: ListSessionsRequest,
  @GrpcCurrentUser() user?: JwtPayload | null,
)
```

`@Payload()` registers `request` in `PARAM_ARGS_METADATA` at index 0, so NestJS correctly injects `args[0]` (the gRPC payload) into it.

### Relevant Files

- `mind_api/src/breath-sessions/breath-sessions.grpc.controller.ts` — fix applied here
- `mind_api/node_modules/@nestjs/microservices/context/rpc-context-creator.js` — where parameter injection logic lives
- `mind_api/node_modules/@nestjs/microservices/factories/rpc-params-factory.js` — `PAYLOAD = args[0]`, `CONTEXT = args[1]`
- `mind_api/node_modules/@nestjs/microservices/context/rpc-metadata-constants.js` — `DEFAULT_GRPC_CALLBACK_METADATA` (only used when no custom decorators present)

## Open Questions

- Should `@Payload()` be added to **all** methods proactively (including required-auth ones) for consistency and to prevent future breakage if auth requirements change?
