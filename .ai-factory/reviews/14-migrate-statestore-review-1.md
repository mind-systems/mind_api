# Code Review — Plan 14: Migrate StateStore

**Files reviewed:** `src/realtime/state-store.ts`, `src/realtime/services/observability.service.ts`
**Related files read:** `live.gateway.ts`, `live.gateway.spec.ts`, `sync-notifier.service.ts`, `authenticated-socket.interface.ts`, `sync.proto`, `tsconfig.json`

**Risk Level:** 🟢 Low

## Verification

- **Type check (`tsc --noEmit`):** No errors in changed files.
- **Tests (`live.gateway.spec.ts`):** All 18 tests pass — `socketMap` is untouched, no consumer breakage.
- **Compiled output:** Confirmed `import { ServerWritableStream }` is correctly elided by the compiler; no runtime `require('@grpc/grpc-js')` emitted in `state-store.js`.

## Suggestions

**1. Use `import type` for `ServerWritableStream`**

`ServerWritableStream` is only used as a type parameter in the `Map` generic — it has no runtime presence. The current `import { ServerWritableStream }` works (TypeScript elides it), but with `isolatedModules: true` in `tsconfig.json`, `import type` is the idiomatic way to signal type-only usage and guarantees erasure regardless of compiler settings:

```ts
import type { ServerWritableStream } from '@grpc/grpc-js';
```

## Positive Notes

- The additive approach (new field alongside existing) is the correct resolution of the original plan's critical issues — no broken intermediate state, no consumer disruption.
- `<unknown, unknown>` generics are the right choice over `<any, any>` — forces downstream controllers to narrow types explicitly.
- `ObservabilityService` reporting both `connectedSockets` and `connectedStreams` gives clear visibility into the migration progress at runtime.

REVIEW_PASS
