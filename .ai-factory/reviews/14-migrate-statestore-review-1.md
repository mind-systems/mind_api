## Code Review Summary

**Files Reviewed:** 2 (`src/realtime/state-store.ts`, `src/realtime/services/observability.service.ts`)
**Related files read:** `realtime.module.ts`, `sync-stream.grpc.controller.ts`, `module-session.grpc.controller.ts`, `module-stream.grpc.controller.ts`, `active-stream-registry.service.ts`, `sync-stream.service.ts`, `presence.service.ts`
**Risk Level:** 🟡 Medium

### Context Gates

- **ARCHITECTURE.md:** WARN — no architectural violation; `StateStore` is a provider within `RealtimeModule`, consistent with module boundaries.
- **RULES.md:** WARN — no sensitive data logged, no non-null assertions. Clean.
- **ROADMAP.md:** WARN — roadmap item 3.3 "Migrate StateStore" is marked `[x]`, but the original plan assumed gRPC controllers would populate `streamMap` — they use `ActiveStreamRegistry` instead (see Critical Issues).

### Critical Issues

**1. `StateStore.streamMap` is dead code — never populated, metric always reports 0**

`streamMap` was added as a preparatory field for gRPC streaming controllers to register their stream handles. However, all three streaming controllers (`SyncStreamGrpcController`, `ModuleSessionGrpcController`, `ModuleStreamGrpcController`) use `ActiveStreamRegistry` with RxJS `Subscriber` objects — none of them write to `stateStore.streamMap`.

Result: `ObservabilityService` reports `connectedStreams=${this.stateStore.streamMap.size}` which is **always 0**, even when active gRPC streams exist. The metric is misleading.

**Fix:** Either:
- **(a)** Remove `streamMap` from `StateStore` entirely and have `ObservabilityService` read from `ActiveStreamRegistry` (add a `size` getter to it), or
- **(b)** If `streamMap` is intentionally kept for a future use case, at minimum fix the observability metric to reflect the actual count from `ActiveStreamRegistry`.

Option (a) is cleaner — `ActiveStreamRegistry` is the actual source of truth for connected streams.

```typescript
// active-stream-registry.service.ts — add getter
get size(): number {
  let count = 0;
  for (const set of this.streams.values()) {
    count += set.size;
  }
  return count;
}

// observability.service.ts — use it
const connectedStreams = this.activeStreamRegistry.size;
```

**2. `import { ServerWritableStream }` is an unused value import**

`ServerWritableStream` is only referenced as a type parameter in the `Map` generic. Since `streamMap` is never populated, the import has no runtime purpose. If `streamMap` is kept, use `import type` to signal type-only usage and guarantee erasure:

```typescript
import type { ServerWritableStream } from '@grpc/grpc-js';
```

If `streamMap` is removed (per fix (a) above), this import should be deleted entirely.

### Suggestions

None beyond the critical issues above.

### Positive Notes

- The plan's additive approach (new field alongside existing `socketMap`) was the right call — it avoided breaking Socket.IO consumers during the transition.
- Using `<unknown, unknown>` generics instead of `<any, any>` was a good type-safety choice.
- `ObservabilityService` structure is clean — single `@Interval` method with clear metric names.
