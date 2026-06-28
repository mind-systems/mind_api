# Plan: Janitor for childless root sessions

## Context
Lazy roots accumulate on stream connects that never start a practice. Add a TTL-based reaper that deletes childless `root` sessions (the FK `ON DELETE CASCADE` removes any bio they carried), leaving roots with ≥1 child untouched.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Scope
All changes are confined to `src/realtime/services/session-watchdog.service.ts` (no new constructor dependency — see the "In-memory store" design note below for why store cleanup is not required). The config key `RealtimeConfig.EMPTY_ROOT_TTL_MS` (`WS_EMPTY_ROOT_TTL_MS`) already exists at `src/realtime/constants/realtime-config.ts:14` and is currently orphaned — `sweepEmptyRoots()` becomes its sole consumer. Schema prerequisites (`ActivityType.ROOT = 'root'`, nullable self-FK `rootSessionId` with `ON DELETE CASCADE` via migration `1782658936664-AddRootSessionLink`) are already landed. The committed test suite `session-watchdog.service.spec.ts` (lines 318–453, 456–509) pins the exact contract — do not deviate from the call shapes below.

## Design note — in-memory store cleanup is NOT required
The first review flagged a potential dangling-state bug: after the janitor deletes a root's DB row, could `ActivitySessionStore.getRoot(userId)` still point at the deleted id (causing the idempotent `ensureRoot` at `activity-engine.service.ts:78-91` to hand back a stale root id, then an FK violation when a child references it)? Tracing the disconnect → grace → abandon path shows it cannot, so **no store eviction is added**:

- The reconnect grace period is **30s** (`DEFAULT_GRACE_MS = 30_000`, `activity-session-store.service.ts:5`; overridable via `WS_RECONNECT_GRACE_MS`), far below the **600_000 ms** (10 min) empty-root TTL.
- On transport disconnect, `handleTransportDisconnect` (`activity-engine.service.ts:630-650`) sets the root `DISCONNECTED` and starts a grace timer. At +30s the timer fires `abandonActivity`, which sets the row to `ABANDONED` **and** calls `removeSessionFromStore → removeRoot` (`activity-engine.service.ts:300-312, 60-66`) — clearing the store entry.
- Therefore, by the time a childless root could be a janitor candidate (≥10 min stale and still `ACTIVE`/`DISCONNECTED`), one of these holds: (a) it was cleanly disconnected → already `ABANDONED` (excluded by the status filter) with its store entry removed; (b) it is `ACTIVE` with a live subscriber → skipped by the `hasLiveSubscriber` guard, store entry legitimately live; or (c) its grace timer was lost to a **server restart** → the in-memory store is empty after reboot, so it holds no reference to the row.
- The previously-prescribed `activeStreamRegistry.closeAll(row.userId)` is additionally a confirmed **no-op** in the delete path: the `!hasLiveSubscriber` guard already guarantees zero registry entries for the user, so `closeAll` returns early (`active-stream-registry.service.ts:39`). It does not touch `ActivitySessionStore` at all. It is therefore omitted.

If a future change shortens the TTL below the grace period or introduces an `ACTIVE`-without-subscriber resident root, revisit this by injecting `ActivitySessionStore` and calling `removeRoot(row.userId)` guarded by `getRootId(userId) === row.id` — out of scope here.

## Tasks

### Phase 1: Janitor implementation

- [x] **Task 1: Read `WS_EMPTY_ROOT_TTL_MS` config in the constructor**
  Files: `src/realtime/services/session-watchdog.service.ts`
  Add a `private readonly emptyRootTtlMs: number;` field next to `maxIdleMs`/`sweepIntervalMs` (around line 21–23). In the constructor, after the existing `sweepIntervalMs` read (`:36-39`), add:
  ```ts
  this.emptyRootTtlMs = this.configService.get<number>(
    RealtimeConfig.EMPTY_ROOT_TTL_MS,
    600_000,
  );
  ```
  The `600_000` (10 min) default mirrors the `SESSION_MAX_IDLE_MS` precedent. `RealtimeConfig` is already imported. (The committed spec injects `WS_EMPTY_ROOT_TTL_MS = 300_000` and asserts the threshold against that injected value, overriding the default — `spec.ts:418`.)

- [x] **Task 2: Implement `sweepEmptyRoots()` as a sibling method** (depends on Task 1)
  Files: `src/realtime/services/session-watchdog.service.ts`
  Add a NEW public method `async sweepEmptyRoots(): Promise<void>` alongside `sweep()` — do NOT fold it into `sweep()` (delete vs abandon semantics must not mix; `sweep()`'s body must stay byte-identical so its characterization tests stay green). The method must:
  - Build the candidate query mirroring `sweep()` (`:57-63`) but scoped to roots:
    ```ts
    const threshold = new Date(Date.now() - this.emptyRootTtlMs);
    const staleRoots = await this.repo.find({
      where: {
        activityType: ActivityType.ROOT,
        status: In([SessionStatus.ACTIVE, SessionStatus.DISCONNECTED]),
        lastActivityAt: LessThan(threshold),
      },
    });
    ```
    The `activityType: 'root'` scope is mandatory — without it a disconnected practice child would be misread as childless and cascade-deleted (spec P6, `spec.ts:422-428`).
  - **Empty-result guard:** immediately after the query, `if (staleRoots.length === 0) return;` — parity with `sweep()` (`:65-67`) and defensive against an empty/undefined result so the per-row loop never iterates a non-array. (In the lifecycle spec at `spec.ts:491-509` the default `repo.find` mock resolves to `undefined`; the interval callback's `.catch` would swallow a throw, but the guard avoids relying on that.)
  - Loop per candidate. For each row:
    - Skip if `this.activeStreamRegistry.hasLiveSubscriber(row.userId)` is true (reuse the exact guard from `:71`).
    - Count children with the repository (NOT raw `repo.query`/`repo.exists` — the committed mock only provides `find`/`count`/`delete`):
      ```ts
      const childCount = await this.repo.count({ where: { rootSessionId: row.id } });
      ```
      Reap only when `childCount === 0`. A root with ≥1 child is retained — bio alone never protects a root (spec data-loss guard, `spec.ts:353-371`).
    - Reap per-row (NOT a bulk QueryBuilder delete): `await this.repo.delete({ id: row.id });`. The FK `ON DELETE CASCADE` removes any `bio_session_samples` / `session_stream_samples` the root carried. Do NOT call `abandonStale` for roots — abandon would orphan the bio. Per-row `delete({ id })` is the mock-visible contract (spec P3, `spec.ts:338-347`).
  - Wrap each row's reap in try/catch and log via the existing `this.logger` (minimal: a `warn` on reap, `error` on failure), matching `sweep()`'s logging style.
  - Do NOT add any in-memory store eviction (no `closeAll`, no `ActivitySessionStore` injection) — see the "In-memory store cleanup is NOT required" design note above.
  - Import note: `ActivityType` is not yet imported in this file — add `import { ActivityType } from '../enums/activity-type.enum';`. `In`, `LessThan`, `SessionStatus`, `RealtimeConfig` are already imported.
  - TOCTOU note (acceptable, no action): a child could in theory be created between `count === 0` and `delete`. Creating a child implies an active stream / `activity:start`, which the `hasLiveSubscriber` guard already excludes, so the window is negligible for a background janitor; the reap is intentionally not transactional.

- [x] **Task 3: Schedule `sweepEmptyRoots()` on the existing sweep timer** (depends on Task 2)
  Files: `src/realtime/services/session-watchdog.service.ts`
  In `onApplicationBootstrap` (`:42-48`) the single `setInterval(…, this.sweepIntervalMs)` callback currently calls only `this.sweep()`. Extend the SAME callback to also invoke `this.sweepEmptyRoots()` — do NOT add a second `setInterval` and do NOT replace `sweep` as the primary entry (the lifecycle tests assert exactly one `setInterval(…, 60_000)` whose callback invokes the `sweep` spy — `spec.ts:457-509`). Invoke both with independent `.catch(...)` handlers so a failure in one does not suppress the other:
  ```ts
  this.sweepTimer = setInterval(() => {
    this.sweep().catch((err: unknown) => {
      this.logger.error('Periodic watchdog sweep failed', err);
    });
    this.sweepEmptyRoots().catch((err: unknown) => {
      this.logger.error('Periodic empty-root sweep failed', err);
    });
  }, this.sweepIntervalMs);
  ```

## Verify (manual reasoning against committed tests)
- Connect + disconnect, no practice, no bio → root deleted after TTL.
- Connect, stream bio only, never start a practice, disconnect → root reaped after TTL (bio discarded via cascade).
- Connect, start one activity, disconnect → root retained (`repo.count` returns ≥1).
- Live subscriber present → root never reaped past TTL.
- `sweep()` non-root reaping (`abandonStale` + `closeAll`, no `repo.delete`) stays unchanged.
- `npm run build` compiles; `npx jest src/realtime/services/session-watchdog.service.spec.ts` turns the four `[RED until spec 08…]` cases green (lines 329, 353, 375, 406) without perturbing the characterization (`:436`) / lifecycle (`:457-509`) cases.
