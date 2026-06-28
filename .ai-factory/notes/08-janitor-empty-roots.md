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
- `rootSessionId` column + the `activityType = 'root'` value do not exist yet — both are added by the schema task ([[02-root-session-schema]], breadcrumb). This janitor depends on that schema landing first.

### Inlined schema contracts (this note is self-contained — do not open other notes)
- **`ActivityType.ROOT`** — string enum member `ROOT = 'root'` on `src/realtime/enums/activity-type.enum.ts` (current members: `BREATH = 'breath'`, `MEDITATION = 'meditation'`). The candidate query filters `activityType: ActivityType.ROOT` (literal `'root'`).
- **`rootSessionId` column** on `ModuleSession` (`src/realtime/entities/module-session.entity.ts`) — nullable `uuid`, a self-referencing FK to `module_sessions.id` declared `ON DELETE CASCADE`. A child practice carries its parent root's id here; a root row itself has `rootSessionId = null`. The childless check counts rows whose `rootSessionId` equals the root's `id`.
- **Cascade semantics** — because the self-FK is `ON DELETE CASCADE`, deleting a root row automatically removes every `bio_session_samples` / `session_stream_samples` row whose `moduleSessionId` is that root. The janitor therefore only issues `repo.delete({ id: root.id })`; it never deletes bio rows itself.

### Change
- **Add a sibling method** `sweepEmptyRoots()` on `SessionWatchdogService` rather than overloading `sweep()`. Reason: `sweep()` *abandons* (sets `ABANDONED`, emits an event), whereas empty-root cleanup *deletes* the row; mixing delete and abandon semantics in one loop is error-prone. Schedule both from `onApplicationBootstrap` (`session-watchdog.service.ts:42-48`) on a **single** `setInterval(…, this.sweepIntervalMs)` (default 60_000) whose callback calls BOTH `this.sweep()` AND `this.sweepEmptyRoots()`. Do NOT add a second `setInterval` and do NOT replace `sweep` as the callback entry — the lifecycle char (`session-watchdog.service.spec.ts:457-465,491-508`) asserts exactly one `setInterval(…, 60_000)` and that the callback invokes the `sweep` spy.
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
- **Childless check** — use the repository `count`:
  ```ts
  const childCount = await this.repo.count({ where: { rootSessionId: row.id } });
  ```
  Reap only when `childCount === 0`. Do NOT use raw `this.repo.query(...)` or `this.repo.exists(...)`: the committed test mocks only `find` / `count` / `delete` on the repo (`session-watchdog.service.spec.ts:51,64`) and drives the ≥1-child guard purely via `repo.count.mockResolvedValue(1)` (`:356`). A `repo.query(...)` call would hit no mock (returns `undefined` → truthiness misread → throw), breaking the `≥1 child` guard case (`:353`).
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
- The protecting condition is **children only**. Do not re-add a "has bio" exemption — that was the bug: after bio moved to the root, a "keep if bio" rule would make a deleted-practice root linger forever with orphaned bio. The childless `repo.count` check above is the *only* reap gate (plus TTL + no-live-subscriber).
- **Per-row delete, not bulk.** Reap each candidate with `await this.repo.delete({ id: row.id })` inside the loop — do NOT issue a bulk QueryBuilder delete. The committed test asserts the per-root outcome by inspecting `repo.delete.mock.calls` for `{ id: root.id }` (`session-watchdog.service.spec.ts:339-347`); a bulk QB delete is not mock-visible.
- **Config ownership.** This note formally OWNS the `WS_EMPTY_ROOT_TTL_MS` config constant (`RealtimeConfig.EMPTY_ROOT_TTL_MS`, `src/realtime/constants/realtime-config.ts:14`). It was added during the test phase and is currently orphaned — no other production code reads it. `sweepEmptyRoots()` is the sole consumer; it must read the key via `this.configService.get<number>(RealtimeConfig.EMPTY_ROOT_TTL_MS, 600_000)`.
- A root with even one child is real data and stays (and is excluded from stats separately, [[07-exclude-root-from-stats]]).
- After deleting an empty root, also drop its in-memory store entry if present — `store.getRoot(userId)` ([[03-multi-session-store-engine]]) should not point at a deleted row. The existing `sweep()` does not need this because abandon goes through `abandonStale` which clears store state; the delete path must clear it explicitly (or rely on the same `closeAll(userId)` path if the user has no other live sessions).
- Immediate (non-TTL) cleanup when a user deletes their last practice is handled in [[15-deleterun-orphan-root-cleanup]]; this janitor is the TTL backstop for disconnected idle roots.

### Verify
- Connect + disconnect with no practice and no bio → root deleted after TTL.
- Connect, stream bio only, never start a practice, disconnect → root reaped after TTL (idle bio discarded via cascade).
- Connect, start one activity, disconnect → root retained (`repo.count` returns ≥1).
- Live subscriber present → root never reaped even past TTL.

## Test reconciliation (committed tests)

### GREEN list — cases this note flips RED→GREEN
- `session-watchdog.service.spec.ts:329` `sweepEmptyRoots › should reap a childless root past TTL even if it has bio` — depends on (a) a SEPARATE public method `sweepEmptyRoots()` callable via `(service as any).sweepEmptyRoots()`, and (b) a mock-visible per-root reap: `repo.delete({ id: row.id })` (or `abandonStale`, but this note uses delete).
- `session-watchdog.service.spec.ts:353` `should NOT reap a root that has ≥1 child` — depends on the childless gate being `repo.count({ where: { rootSessionId: row.id } }) === 0`. The test sets `repo.count.mockResolvedValue(1)` and asserts NO delete for that root. (Raw `repo.query` would miss the mock and break this case — see Change.)
- `session-watchdog.service.spec.ts:375` `should NOT reap a childless root that has a live subscriber` — depends on reusing `activeStreamRegistry.hasLiveSubscriber(row.userId)` before reaping.
- `session-watchdog.service.spec.ts:406` `should query for empty roots scoped to activityType=root with lastActivityAt LessThan(WS_EMPTY_ROOT_TTL_MS threshold)` — depends on `repo.find({ where: { activityType: 'root', lastActivityAt: LessThan(now - emptyRootTtlMs) } })`, with `emptyRootTtlMs` read from `WS_EMPTY_ROOT_TTL_MS`. Test asserts `where.activityType === 'root'` AND `where.lastActivityAt` is a `LessThan` `FindOperator` whose value equals `new Date(FIXED_NOW - DEFAULT_EMPTY_ROOT_TTL_MS)` (the mock returns the key value, overriding the code default).

### Invariants that must stay GREEN (this note must NOT perturb)
- `session-watchdog.service.spec.ts:98-153` `sweep — query construction` — `sweep()` body stays byte-identical (sibling method, not overload). Test asserts `repo.find` called exactly once for `sweep()`.
- `session-watchdog.service.spec.ts:436` `should leave non-root stale-session reaping behavior unchanged` — `sweep()` alone still fires `abandonStale` + `closeAll`, and `repo.delete` is NOT called (sweepEmptyRoots is a separate method, not invoked here).
- `session-watchdog.service.spec.ts:457-509` lifecycle bootstrap — a SINGLE `setInterval(…, 60_000)` whose callback invokes the `sweep` spy. Adding a second timer or replacing the callback entry breaks `:464` / `:508`.

### Resolved gap-fixes
- Childless check changed from raw `repo.query('SELECT 1 …')` / `repo.exists` to `repo.count({ where: { rootSessionId: row.id } }) === 0` — the committed mock has only `find/count/delete`.
- Scheduling pinned to a SINGLE `setInterval(…, 60_000)` whose callback calls BOTH `this.sweep()` AND `this.sweepEmptyRoots()`.
- Per-row `repo.delete({ id })` retained (not bulk) for mock visibility.
- This note formally OWNS the `WS_EMPTY_ROOT_TTL_MS` constant (previously orphaned at `realtime-config.ts:14`).
