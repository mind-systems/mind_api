## Code Review — Patch 14-migrate-statestore-patch-1

**Files reviewed:** `src/realtime/state-store.ts`, `src/realtime/services/active-stream-registry.service.ts`, `src/realtime/services/observability.service.ts`
**Related files read:** `realtime.module.ts`, `presence.service.ts`, `presence.service.spec.ts`, `activity-session-store.service.ts`, `sync-stream.grpc.controller.ts`, `module-session.grpc.controller.ts`

### Changes summary

1. **`state-store.ts`** — removed dead `streamMap` field and `ServerWritableStream` import; only `presenceMap` remains.
2. **`active-stream-registry.service.ts`** — added `get size()` getter that sums subscriber counts across all users.
3. **`observability.service.ts`** — replaced `StateStore` dependency with `ActiveStreamRegistry`; `connectedStreams` metric now reads from the actual source of truth.

### Verification

- **No remaining `streamMap` references in source code** — confirmed via grep. Only `.ai-factory/` plan/review docs reference it.
- **No remaining `ServerWritableStream` imports** — confirmed via grep across `src/`.
- **`StateStore` still needed** — `PresenceService` injects it for `presenceMap`. `presence.service.spec.ts` constructs it directly; test only accesses `presenceMap` — no breakage.
- **DI wiring intact** — `ActiveStreamRegistry` is already a provider in `RealtimeModule` (line 36); `ObservabilityService` is in the same module (line 34). No module import changes needed.
- **`ActiveStreamRegistry.size` correctness** — iterates `Map.values()` and sums `Set.size`. Returns 0 for empty map. Read-only, no mutations. Single-threaded Node.js — no race conditions.
- **`ActivitySessionStore.size`** — confirmed the same getter pattern exists (line 35: `get size(): number { return this.activityMap.size; }`). `ObservabilityService` usage is consistent.
- **No test files for `ObservabilityService` or `ActiveStreamRegistry`** — no test updates needed. Existing `presence.service.spec.ts` unaffected by `StateStore` field removal.

### Issues

None found.

REVIEW_PASS
