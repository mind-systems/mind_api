# Patch: 14-migrate-statestore

Addresses all issues from `reviews/14-migrate-statestore-review-1.md`.

## Issue 1: `StateStore.streamMap` is dead code — remove it

`streamMap` is never populated by any code. All gRPC streaming controllers use `ActiveStreamRegistry` instead. The field and its import serve no purpose.

### Fix 1a: Remove `streamMap` and unused import from `StateStore`

**File:** `src/realtime/state-store.ts`

Replace the entire file contents:

```typescript
// BEFORE
import { Injectable } from '@nestjs/common';
import { ServerWritableStream } from '@grpc/grpc-js';
import { PresenceState } from './interfaces/presence-state.interface';

@Injectable()
export class StateStore {
  readonly streamMap = new Map<string, ServerWritableStream<unknown, unknown>>();
  readonly presenceMap = new Map<string, PresenceState>();
}
```

```typescript
// AFTER
import { Injectable } from '@nestjs/common';
import { PresenceState } from './interfaces/presence-state.interface';

@Injectable()
export class StateStore {
  readonly presenceMap = new Map<string, PresenceState>();
}
```

**What changes:** Remove `import { ServerWritableStream }` (line 2) and `readonly streamMap` field (line 7). `presenceMap` is the only field still in use (by `PresenceService`).

---

## Issue 2: `ObservabilityService` reports `connectedStreams` from the dead `streamMap` (always 0)

The metric must read from `ActiveStreamRegistry` — the actual source of truth for connected gRPC streams. This requires two sub-steps: adding a `size` getter to `ActiveStreamRegistry`, then rewiring `ObservabilityService`.

### Fix 2a: Add `size` getter to `ActiveStreamRegistry`

**File:** `src/realtime/services/active-stream-registry.service.ts`

Add a `get size()` accessor after the `streams` field declaration (after line 6):

```typescript
// BEFORE (lines 5–7)
export class ActiveStreamRegistry implements OnModuleDestroy {
  private readonly streams = new Map<string, Set<Subscriber<any>>>();

  register(userId: string, subscriber: Subscriber<any>): void {
```

```typescript
// AFTER
export class ActiveStreamRegistry implements OnModuleDestroy {
  private readonly streams = new Map<string, Set<Subscriber<any>>>();

  get size(): number {
    let count = 0;
    for (const set of this.streams.values()) {
      count += set.size;
    }
    return count;
  }

  register(userId: string, subscriber: Subscriber<any>): void {
```

**What changes:** New read-only getter that sums subscriber counts across all user sets. Zero allocations — iterates the existing Map values.

### Fix 2b: Rewire `ObservabilityService` to use `ActiveStreamRegistry`

**File:** `src/realtime/services/observability.service.ts`

**Step 1 — Replace imports (line 3):**

```typescript
// BEFORE
import { StateStore } from '../state-store';
import { ActivitySessionStore } from './activity-session-store.service';
```

```typescript
// AFTER
import { ActivitySessionStore } from './activity-session-store.service';
import { ActiveStreamRegistry } from './active-stream-registry.service';
```

**Step 2 — Replace constructor injection (lines 10–13):**

```typescript
// BEFORE
  constructor(
    private readonly stateStore: StateStore,
    private readonly activitySessionStore: ActivitySessionStore,
  ) {}
```

```typescript
// AFTER
  constructor(
    private readonly activitySessionStore: ActivitySessionStore,
    private readonly activeStreamRegistry: ActiveStreamRegistry,
  ) {}
```

**Step 3 — Replace metric source (line 18):**

```typescript
// BEFORE
    const connectedStreams = this.stateStore.streamMap.size;
```

```typescript
// AFTER
    const connectedStreams = this.activeStreamRegistry.size;
```

**Final state of the file:**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ActivitySessionStore } from './activity-session-store.service';
import { ActiveStreamRegistry } from './active-stream-registry.service';

@Injectable()
export class ObservabilityService {
  private readonly logger = new Logger(ObservabilityService.name);

  constructor(
    private readonly activitySessionStore: ActivitySessionStore,
    private readonly activeStreamRegistry: ActiveStreamRegistry,
  ) {}

  @Interval(60_000)
  logMetrics(): void {
    const activeSessions = this.activitySessionStore.size;
    const connectedStreams = this.activeStreamRegistry.size;
    this.logger.log(
      `Realtime metrics: activeSessions=${activeSessions} connectedStreams=${connectedStreams}`,
    );
  }
}
```

**What changes:** `StateStore` dependency removed, replaced by `ActiveStreamRegistry`. The `connectedStreams` metric now reflects the real count of active gRPC subscriber streams.

---

## Verification checklist

- [ ] `StateStore` still works — only `presenceMap` remains, used by `PresenceService` (5 call sites) and `presence.service.spec.ts`
- [ ] `ObservabilityService` compiles — `ActiveStreamRegistry` is already a provider in `RealtimeModule`, no module import changes needed
- [ ] `ActiveStreamRegistry.size` returns correct count — sum of all `Set` sizes across the `Map`
- [ ] No other file references `streamMap` — confirmed via `grep`, only `state-store.ts` and `observability.service.ts` reference it
- [ ] `realtime.module.ts` needs no changes — `StateStore` remains in `providers` and `exports` (still used by `PresenceService`); `ActiveStreamRegistry` already in `providers`
- [ ] Run `npx tsc --noEmit` after applying
- [ ] Run `npx jest src/realtime/` after applying
