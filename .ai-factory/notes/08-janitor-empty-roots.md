# Janitor for childless root sessions

**Date:** 2026-06-28
**Source:** conversation context

## Decisions (locked)
- `WS_EMPTY_ROOT_TTL_MS` default = **600_000** (10 min), matching the `SESSION_MAX_IDLE_MS` precedent (`src/realtime/constants/realtime-config.ts:12`, watchdog default at `session-watchdog.service.ts:34`).

## Key Findings

- Lazy root creation ([[04-lazy-root-creation]]) materializes a root on every stream connect. A reaper removes roots that have **no children**, after a TTL — regardless of whether they carry bio.
- Bio alone does **not** keep a root alive: a childless root is bio without any practice context ("noise without instructions" in the original design philosophy), and after the 1:1 migration a childless root is one whose practice was deleted. Deleting the root cascades its bio away (FK `ON DELETE CASCADE`, [[02-root-session-schema]]). The only thing that protects a root is having at least one child.

## Details

### Current state — `src/realtime/services/session-watchdog.service.ts`
- `sweep()` (`session-watchdog.service.ts:56-91`) runs every `WS_SESSION_SWEEP_INTERVAL_MS` (default `60_000`, `:36-39`). It queries `repo.find({ where: { status: In([ACTIVE, DISCONNECTED]), lastActivityAt: LessThan(threshold) } })` (`:58-63`), where `threshold = now - maxIdleMs` and `maxIdleMs = WS_SESSION_MAX_IDLE_MS` default `600_000` (`:32-35,57`). It skips rows whose user has a live subscriber via `this.activeStreamRegistry.hasLiveSubscriber(row.userId)` (`:71`), then calls `this.activityEngine.abandonStale(row.userId, row.id)` (`:82`) and `this.activeStreamRegistry.closeAll(row.userId)` (`:83`).
- The current sweep does NOT filter by `activityType` and does NOT inspect children — it abandons any stale ACTIVE/DISCONNECTED row.
- `rootSessionId` column + the `activityType = 'root'` value do not exist yet — both are added by [[02-root-session-schema]] (`ActivityType.ROOT = 'root'`, nullable `rootSessionId` column, self-FK `FK_module_sessions_rootSessionId ... ON DELETE CASCADE`). This janitor depends on that schema landing first.

### Change
- **Add a sibling method** `sweepEmptyRoots()` on `SessionWatchdogService` rather than overloading `sweep()`. Reason: `sweep()` *abandons* (sets `ABANDONED`, emits an event), whereas empty-root cleanup *deletes* the row; mixing delete and abandon semantics in one loop is error-prone. Schedule both from `onApplicationBootstrap` (`session-watchdog.service.ts:42-48`) on the same `sweepIntervalMs` timer (call both inside the existing `setInterval` callback).
- `sweepEmptyRoots()` selects stale roots:
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
  (mirrors the existing query at `session-watchdog.service.ts:58-63`, adding the `activityType` filter).
- For each candidate, **skip if a live subscriber is present** — reuse the existing guard verbatim: `this.activeStreamRegistry.hasLiveSubscriber(row.userId)` (same call as `session-watchdog.service.ts:71`). A live root streaming bio but with no practice yet survives (its `lastActivityAt` is refreshed by every bio flush — `biometric-stream-engine.service.ts:183-184` — so it is not stale anyway).
- **Childless check** — exact SQL, parameterized:
  ```sql
  SELECT 1 FROM module_sessions WHERE "rootSessionId" = $1 LIMIT 1
  ```
  Run via `this.repo.query('SELECT 1 FROM module_sessions WHERE "rootSessionId" = $1 LIMIT 1', [row.id])`; reap only when it returns zero rows. (Equivalent TypeORM form: `this.repo.exists({ where: { rootSessionId: row.id } })` → reap when `false`.)
- **Delete (not abandon)** the empty root: `await this.repo.delete({ id: row.id })`. The FK `ON DELETE CASCADE` ([[02-root-session-schema]]) removes any `bio_session_samples` / `session_stream_samples` the root carried. Do **not** call `abandonStale` for roots — abandon would leave the orphaned bio attached forever.
- Add config read in the constructor (next to `maxIdleMs`/`sweepIntervalMs`, `session-watchdog.service.ts:32-39`):
  ```ts
  this.emptyRootTtlMs = this.configService.get<number>(
    RealtimeConfig.EMPTY_ROOT_TTL_MS,
    600_000,
  );
  ```
  Config key already added: `RealtimeConfig.EMPTY_ROOT_TTL_MS = 'WS_EMPTY_ROOT_TTL_MS'` (`src/realtime/constants/realtime-config.ts:14`).

### Guards / gotchas
- The protecting condition is **children only**. Do not re-add a "has bio" exemption — that was the bug: after bio moved to the root, a "keep if bio" rule would make a deleted-practice root linger forever with orphaned bio. The childless SQL above is the *only* reap gate (plus TTL + no-live-subscriber).
- A root with even one child is real data and stays (and is excluded from stats separately, [[07-exclude-root-from-stats]]).
- After deleting an empty root, also drop its in-memory store entry if present — `store.getRoot(userId)` ([[03-multi-session-store-engine]]) should not point at a deleted row. The existing `sweep()` does not need this because abandon goes through `abandonStale` which clears store state; the delete path must clear it explicitly (or rely on the same `closeAll(userId)` path if the user has no other live sessions).
- Immediate (non-TTL) cleanup when a user deletes their last practice is handled in [[15-deleterun-orphan-root-cleanup]]; this janitor is the TTL backstop for disconnected idle roots.

### Verify
- Connect + disconnect with no practice and no bio → root deleted after TTL.
- Connect, stream bio only, never start a practice, disconnect → root reaped after TTL (idle bio discarded via cascade).
- Connect, start one activity, disconnect → root retained (childless SQL returns a row).
- Live subscriber present → root never reaped even past TTL.
