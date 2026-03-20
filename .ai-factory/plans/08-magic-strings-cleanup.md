# 08 — Magic Strings Cleanup

**Branch:** `08-magic-strings-cleanup` (from `03-shared-suggestions`)
**Created:** 2026-03-21
**Review:** `.ai-factory/reviews/03-shared-suggestions` + `.ai-factory/notes/code-review-03-shared-suggestions.md`

## Settings

- **Testing:** No (refactoring — existing tests cover behavior; update raw strings in tests to use new constants)
- **Logging:** Minimal (no new logging)
- **Docs:** No (internal refactoring, API unchanged)

---

## Tasks

### Phase 1 — Create constants & enums

#### Task 1. SessionEvents const + RESUMED in SessionStatus

Create `src/realtime/events/session.events.ts`:
```typescript
export const SessionEvents = {
  COMPLETED: 'session.completed',
  ABANDONED: 'session.abandoned',
  INTERRUPTED: 'session.interrupted',
} as const;
```

Add `RESUMED = 'resumed'` to `src/realtime/enums/session-status.enum.ts`.

**Files:** `src/realtime/events/session.events.ts` (new), `src/realtime/enums/session-status.enum.ts`

#### Task 2. ChangeEntity + ChangeAction enums

Create `src/changelog/changelog.enums.ts`:
```typescript
export enum ChangeEntity {
  BREATH_SESSION = 'breath_session',
}

export enum ChangeAction {
  CREATED = 'created',
  UPDATED = 'updated',
  DELETED = 'deleted',
}
```

Type-tighten `ChangeEventPayload` in `changelog.events.ts` — change `entity: string` → `entity: ChangeEntity`, `action: string` → `action: ChangeAction`.

Also type-tighten `ChangeLogService.log()` signature to accept `ChangeEntity` and `ChangeAction` instead of plain strings.

**Files:** `src/changelog/changelog.enums.ts` (new), `src/changelog/changelog.events.ts`, `src/changelog/changelog.service.ts`

#### Task 3. WS error codes

Create `src/realtime/constants/ws-error-codes.ts`:
```typescript
export const WsErrorCode = {
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  NO_SESSION: 'NO_SESSION',
  SESSION_MISMATCH: 'SESSION_MISMATCH',
  NO_ACTIVE_SESSION: 'no_active_session',
  ALREADY_PAUSED: 'already_paused',
  NOT_PAUSED: 'not_paused',
  SESSION_PAUSED: 'session_paused',
} as const;
```

**Files:** `src/realtime/constants/ws-error-codes.ts` (new)

#### Task 4. Stream data type constants

Create `src/realtime/constants/stream-data-types.ts`:
```typescript
export const StreamDataType = {
  SESSION_EVENT: 'session_event',
  BREATH_PHASE: 'breath_phase',
} as const;

export const StreamSessionEvent = {
  STARTED: 'session_started',
  ENDED: 'session_ended',
  ABANDONED: 'session_abandoned',
  INTERRUPTED: 'session_interrupted',
  PAUSED: 'paused',
  RESUMED: 'resumed',
} as const;
```

**Files:** `src/realtime/constants/stream-data-types.ts` (new)

#### Task 5. Realtime config keys

Create `src/realtime/constants/realtime-config.ts`:
```typescript
export const RealtimeConfig = {
  RATE_LIMIT_ACTIVITY_START_PER_MIN: 'WS_RATE_LIMIT_ACTIVITY_START_PER_MIN',
  RATE_LIMIT_MAX_EVENTS: 'WS_RATE_LIMIT_MAX_EVENTS',
  RATE_LIMIT_WINDOW_MS: 'WS_RATE_LIMIT_WINDOW_MS',
  STREAM_MAX_BUFFER_BYTES: 'WS_STREAM_MAX_BUFFER_BYTES',
  STREAM_MAX_SESSIONS: 'WS_STREAM_MAX_SESSIONS',
  BACKPRESSURE_SAMPLES_PER_SEC: 'WS_BACKPRESSURE_SAMPLES_PER_SEC',
  STREAM_FLUSH_INTERVAL_MS: 'WS_STREAM_FLUSH_INTERVAL_MS',
} as const;
```

Also add `SUGGESTIONS_COMPLEXITY_THRESHOLD` to breath-sessions — inline in the service file as a local const (single usage, no need for a separate file).

**Files:** `src/realtime/constants/realtime-config.ts` (new), `src/breath-sessions/breath-sessions.service.ts` (local const)

---

### Phase 2 — Replace in realtime module

#### Task 6. activity-engine.service.ts — replace all magic strings

- `emit('session.completed/abandoned/interrupted')` → `SessionEvents.*`
- `dataType: 'session_event'` → `StreamDataType.SESSION_EVENT`
- `event: 'session_started'` etc. → `StreamSessionEvent.*`
- `throw new Error('no_active_session')` etc. → `WsErrorCode.*`

**Files:** `src/realtime/services/activity-engine.service.ts`
**Depends on:** Tasks 1, 3, 4

#### Task 7. live.gateway.ts — SessionStatus enum + error codes + config keys

- `status: 'active'/'completed'/'interrupted'/'resumed'` → `SessionStatus.*`
- `'RATE_LIMIT_EXCEEDED'` → `WsErrorCode.RATE_LIMIT_EXCEEDED`
- `'no_active_session'` → `WsErrorCode.NO_ACTIVE_SESSION`
- `'WS_RATE_LIMIT_*'` → `RealtimeConfig.*`

**Files:** `src/realtime/gateways/live.gateway.ts`
**Depends on:** Tasks 1, 3, 5

#### Task 8. telemetry.gateway.ts — error codes + data type check

- `'NO_SESSION'` → `WsErrorCode.NO_SESSION`
- `'SESSION_MISMATCH'` → `WsErrorCode.SESSION_MISMATCH`
- `'session_paused'` → `WsErrorCode.SESSION_PAUSED`
- `dataType === 'breath_phase'` → `StreamDataType.BREATH_PHASE`

**Files:** `src/realtime/gateways/telemetry.gateway.ts`
**Depends on:** Tasks 3, 4

#### Task 9. stream-engine.service.ts — @OnEvent + config keys

- `@OnEvent('session.completed/abandoned/interrupted')` → `SessionEvents.*`
- `'WS_STREAM_*'` / `'WS_BACKPRESSURE_*'` → `RealtimeConfig.*`

**Files:** `src/realtime/services/stream-engine.service.ts`
**Depends on:** Tasks 1, 5

#### Task 10. ws-rate-limit.guard.ts + ws-exception.filter.ts

- Guard: `'RATE_LIMIT_EXCEEDED'` → `WsErrorCode.RATE_LIMIT_EXCEEDED`, config keys → `RealtimeConfig.*`
- Filter: `client.emit('exception', ...)` — extract `'exception'` to a const in `live.events.ts` (`WS_EXCEPTION = 'exception'`)

**Files:** `src/realtime/guards/ws-rate-limit.guard.ts`, `src/realtime/filters/ws-exception.filter.ts`, `src/realtime/events/live.events.ts`
**Depends on:** Tasks 3, 5

---

### Phase 3 — Replace in other modules

#### Task 11. breath-sessions.service.ts — ChangeEntity/ChangeAction + config key

- `changeLogService.log('breath_session', id, 'created', userId)` → `ChangeEntity.BREATH_SESSION`, `ChangeAction.CREATED` etc.
- `'SUGGESTIONS_COMPLEXITY_THRESHOLD'` → local const

**Files:** `src/breath-sessions/breath-sessions.service.ts`
**Depends on:** Tasks 2, 5

#### Task 12. stats.worker.ts — @OnEvent

- `@OnEvent('session.completed/abandoned/interrupted')` → `SessionEvents.*`

**Files:** `src/stats/stats.worker.ts`
**Depends on:** Task 1

---

### Phase 4 — Update tests

#### Task 13. Replace magic strings in test files

Update raw strings to use imported constants in:
- `src/realtime/services/activity-engine.service.spec.ts`
- `src/realtime/gateways/live.gateway.spec.ts`
- `src/realtime/gateways/telemetry.gateway.spec.ts`
- `src/realtime/services/stream-engine.service.spec.ts`
- `src/realtime/guards/ws-rate-limit.guard.spec.ts`
- `src/stats/stats.worker.spec.ts`
- `src/breath-sessions/breath-sessions.service.spec.ts`

Only replace strings that now have a corresponding constant — don't introduce new test logic.

**Depends on:** Tasks 6–12

---

## Commit Plan

| Checkpoint | After tasks | Message |
|------------|-------------|---------|
| Commit 1 | 1–5 | `refactor: add constants and enums for magic strings` |
| Commit 2 | 6–10 | `refactor: replace magic strings in realtime module` |
| Commit 3 | 11–13 | `refactor: replace magic strings in remaining modules and tests` |

---

## Out of Scope

- **Config keys in `auth.module.ts` (`JWT_SECRET`) and `mail.service.ts` (`RESEND_API_KEY`)** — single-use, module-private, unlikely to drift. Not worth extracting.
- **Raw SQL in `changelog.service.ts`** — table/column names in SQL are inherently stringly-typed; extracting them into constants doesn't add safety.
- **Template placeholders in `mail.service.ts`** (`{{magic_link}}` etc.) — matched against HTML templates, not code. Extracting adds indirection without benefit.
- **Naming inconsistency** (`live_session.paused` dot-style vs `activity:start` colon-style) — cosmetic; changing would require mobile client update. Separate ticket.
