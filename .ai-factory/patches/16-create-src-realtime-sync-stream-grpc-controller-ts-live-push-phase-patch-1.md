# Patch: 16-create-src-realtime-sync-stream-grpc-controller-ts-live-push-phase

Addresses all issues from `reviews/16-create-src-realtime-sync-stream-grpc-controller-ts-live-push-phase-review-1.md`.

## Issue 1 + 2: `SyncStreamService` single-stream-per-user overwrites and orphaned debounce timer

When the same user opens a second `WatchChanges` stream (reconnection, multi-device), `register()` silently overwrites the first entry. The old entry's pending debounce timer is leaked (never cleared). When the old stream eventually tears down, `deregister(userId)` deletes the entire map entry — killing the new stream's push callback too.

### Root cause

`SyncStreamService` uses `Map<string, StreamEntry>` — one entry per user. `deregister(userId)` deletes the entry by userId without checking which stream is deregistering. This conflicts with `ActiveStreamRegistry` which correctly uses `Map<string, Set<Subscriber>>` and scopes operations to a specific subscriber instance.

### Fix: Set-based callback tracking with shared per-user debounce

Restructure the internal map to `Map<string, UserEntry>` where `UserEntry` holds a `Set` of push callbacks (one per stream) and a shared `PendingEntry` for debounce batching. `deregister` removes a specific callback by identity. The debounce timer and event buffer are shared per-user — when the timer fires, the batched events are broadcast to all registered callbacks.

**File:** `src/realtime/services/sync-stream.service.ts`

```typescript
// BEFORE (full file, lines 1-70)
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CHANGE_EVENT_LOGGED } from 'src/changelog';
import type { ChangeEventPayload } from 'src/changelog';

export interface LiveEvent {
  id: number;
  entity: string;
  refId: string;
  action: string;
}

interface PendingEntry {
  timer: NodeJS.Timeout;
  events: LiveEvent[];
}

interface StreamEntry {
  push: (events: LiveEvent[]) => void;
  pending: PendingEntry | null;
}

@Injectable()
export class SyncStreamService implements OnModuleDestroy {
  private readonly streams = new Map<string, StreamEntry>();

  register(userId: string, push: (events: LiveEvent[]) => void): void {
    this.streams.set(userId, { push, pending: null });
  }

  deregister(userId: string): void {
    const entry = this.streams.get(userId);
    if (entry?.pending) {
      clearTimeout(entry.pending.timer);
    }
    this.streams.delete(userId);
  }

  @OnEvent(CHANGE_EVENT_LOGGED)
  onChangeLogged(payload: ChangeEventPayload): void {
    const { id, entity, refId, action, userId } = payload;
    const entry = this.streams.get(userId);
    if (!entry) return;

    if (entry.pending) {
      entry.pending.events.push({ id, entity, refId, action });
    } else {
      const timer = setTimeout(() => this.flush(userId), 300);
      entry.pending = { timer, events: [{ id, entity, refId, action }] };
    }
  }

  private flush(userId: string): void {
    const entry = this.streams.get(userId);
    if (!entry?.pending) return;

    const { events } = entry.pending;
    entry.pending = null;
    entry.push(events);
  }

  onModuleDestroy(): void {
    for (const entry of this.streams.values()) {
      if (entry.pending) {
        clearTimeout(entry.pending.timer);
      }
    }
    this.streams.clear();
  }
}
```

```typescript
// AFTER
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CHANGE_EVENT_LOGGED } from 'src/changelog';
import type { ChangeEventPayload } from 'src/changelog';

export type PushCallback = (events: LiveEvent[]) => void;

export interface LiveEvent {
  id: number;
  entity: string;
  refId: string;
  action: string;
}

interface PendingEntry {
  timer: NodeJS.Timeout;
  events: LiveEvent[];
}

interface UserEntry {
  callbacks: Set<PushCallback>;
  pending: PendingEntry | null;
}

@Injectable()
export class SyncStreamService implements OnModuleDestroy {
  private readonly streams = new Map<string, UserEntry>();

  register(userId: string, push: PushCallback): void {
    let entry = this.streams.get(userId);
    if (!entry) {
      entry = { callbacks: new Set(), pending: null };
      this.streams.set(userId, entry);
    }
    entry.callbacks.add(push);
  }

  deregister(userId: string, push: PushCallback): void {
    const entry = this.streams.get(userId);
    if (!entry) return;
    entry.callbacks.delete(push);
    if (entry.callbacks.size === 0) {
      if (entry.pending) {
        clearTimeout(entry.pending.timer);
      }
      this.streams.delete(userId);
    }
  }

  @OnEvent(CHANGE_EVENT_LOGGED)
  onChangeLogged(payload: ChangeEventPayload): void {
    const { id, entity, refId, action, userId } = payload;
    const entry = this.streams.get(userId);
    if (!entry) return;

    if (entry.pending) {
      entry.pending.events.push({ id, entity, refId, action });
    } else {
      const timer = setTimeout(() => this.flush(userId), 300);
      entry.pending = { timer, events: [{ id, entity, refId, action }] };
    }
  }

  private flush(userId: string): void {
    const entry = this.streams.get(userId);
    if (!entry?.pending) return;

    const { events } = entry.pending;
    entry.pending = null;
    for (const push of entry.callbacks) {
      push(events);
    }
  }

  onModuleDestroy(): void {
    for (const entry of this.streams.values()) {
      if (entry.pending) {
        clearTimeout(entry.pending.timer);
      }
    }
    this.streams.clear();
  }
}
```

**What changes:**

1. **`StreamEntry` → `UserEntry`** — holds a `Set<PushCallback>` instead of a single `push` function, plus the shared `PendingEntry`. Multiple streams for the same user coexist; each gets its own callback in the set.

2. **`register(userId, push)`** — gets-or-creates the `UserEntry` and adds the callback to the set. No silent overwrite. If an entry already exists (concurrent stream), the new callback is added alongside the existing one.

3. **`deregister(userId, push)`** — removes the specific callback by reference identity. Only clears the pending timer and deletes the map entry when the last callback is removed (set becomes empty). A stale stream's teardown no longer kills the active stream's callback.

4. **`flush(userId)`** — iterates all callbacks in the set and calls each with the same batched events. The debounce timer and event buffer remain shared per-user (one batch, broadcast to all streams).

5. **`PushCallback` type** — exported so the controller can reference it if needed. The type is `(events: LiveEvent[]) => void`, unchanged from before.

### Fix 2: Update controller `deregister` calls to pass `pushFn`

**File:** `src/realtime/sync-stream.grpc.controller.ts`

`deregister()` now requires the specific callback to remove. Both call sites must pass `pushFn`.

```typescript
// BEFORE (line 87)
          this.syncStreamService.deregister(userId);
```

```typescript
// AFTER (line 87)
          this.syncStreamService.deregister(userId, pushFn);
```

**What changes:** Passes `pushFn` so `deregister` removes only this stream's callback, not the entire user entry.

---

```typescript
// BEFORE (line 134)
        this.syncStreamService.deregister(userId);
```

```typescript
// AFTER (line 134)
        this.syncStreamService.deregister(userId, pushFn);
```

**What changes:** Same fix in the teardown path. When this stream disconnects, only its callback is removed. Other active streams for the same user continue receiving events.

## Verification

- [ ] `npx tsc --noEmit` passes
- [ ] Reconnection scenario: Stream A registers → Stream B registers (same user) → both callbacks in the Set → Stream A teardown removes only its callback → Stream B continues receiving events
- [ ] Single-stream case unchanged: register adds to set, deregister removes from set, set becomes empty, entry deleted, timer cleared — identical cleanup behavior
- [ ] `onModuleDestroy` still clears all timers — iterates `streams.values()` and clears `entry.pending.timer` for each, then clears the map. No change needed.
- [ ] `flush` broadcasts to all callbacks — if one stream is in buffer mode and another in direct mode, each pushFn handles its own mode logic internally (the mode flag lives in the controller closure, not in SyncStreamService)
