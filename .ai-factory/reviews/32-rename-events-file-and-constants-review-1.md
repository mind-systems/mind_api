# Review: 32 — Rename events file and constants

## Scope

| File | Change |
|------|--------|
| `src/realtime/events/live.events.ts` | Deleted |
| `src/realtime/events/module-session.events.ts` | New — two renamed constants |
| `src/realtime/services/activity-engine.service.ts` | Import path + constant names + emit call sites |

## Checks

### 1. Import correctness
- Import path changed from `'../events/live.events'` to `'../events/module-session.events'` — matches new file name. **OK**
- Named imports changed to `MODULE_SESSION_PAUSED`, `MODULE_SESSION_UNPAUSED` — match exported names. **OK**

### 2. Emit call sites
- Line 268: `this.eventEmitter.emit(MODULE_SESSION_PAUSED, ...)` — correct. **OK**
- Line 300: `this.eventEmitter.emit(MODULE_SESSION_UNPAUSED, ...)` — correct. **OK**

### 3. No stale references
- Grep for `LIVE_SESSION` across `src/` — zero hits. **OK**
- Grep for `live.events` across `src/` — zero hits. **OK**
- Grep for `live_session.paused` / `live_session.unpaused` (old string values) across `src/` — zero hits. **OK**

### 4. Event string values changed — subscriber impact
The string values changed from `'live_session.paused'` → `'module_session.paused'` and `'live_session.unpaused'` → `'module_session.unpaused'`. Grep for `@OnEvent` across the entire `src/` tree shows **no listener subscribes to either old or new string**. These events are emitted but currently have no consumers, so the value change is safe — no runtime breakage.

### 5. Test file
`activity-engine.service.spec.ts` does not reference `LIVE_SESSION_PAUSED`, `LIVE_SESSION_UNPAUSED`, `live.events`, or the old string values. No test update needed. **OK**

### 6. No other consumers
Grep confirmed `live.events.ts` was imported only in `activity-engine.service.ts`. No barrel exports, no re-exports. **OK**

## Verdict

Pure rename — file, constant names, and string values all updated consistently. No stale references, no broken subscribers, no test gaps.

REVIEW_PASS
