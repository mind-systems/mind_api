# Review 1 — Replace Magic Strings in Remaining Modules & Tests

## Scope

- `src/stats/stats.worker.ts` — replaced 3 `@OnEvent` raw strings with `SessionEvents.*`
- `src/realtime/services/activity-engine.service.spec.ts` — replaced 2 event name strings
- `src/realtime/gateways/live.gateway.spec.ts` — replaced 4 status strings + 1 error code
- `src/realtime/gateways/telemetry.gateway.spec.ts` — replaced 2 error code strings
- `src/realtime/guards/ws-rate-limit.guard.spec.ts` — replaced 1 error code string
- `src/realtime/services/stream-engine.service.spec.ts` — replaced 3 config key strings

## Correctness

All replacements are value-preserving:

| Constant | Resolved value | Matches original string |
|---|---|---|
| `SessionEvents.COMPLETED` | `'session.completed'` | Yes |
| `SessionEvents.ABANDONED` | `'session.abandoned'` | Yes |
| `SessionEvents.INTERRUPTED` | `'session.interrupted'` | Yes |
| `SessionStatus.ACTIVE` | `'active'` | Yes |
| `SessionStatus.COMPLETED` | `'completed'` | Yes |
| `SessionStatus.RESUMED` | `'resumed'` | Yes |
| `WsErrorCode.RATE_LIMIT_EXCEEDED` | `'RATE_LIMIT_EXCEEDED'` | Yes |
| `WsErrorCode.NO_SESSION` | `'NO_SESSION'` | Yes |
| `WsErrorCode.SESSION_MISMATCH` | `'SESSION_MISMATCH'` | Yes |
| `RealtimeConfig.STREAM_MAX_BUFFER_BYTES` | `'WS_STREAM_MAX_BUFFER_BYTES'` | Yes |
| `RealtimeConfig.STREAM_MAX_SESSIONS` | `'WS_STREAM_MAX_SESSIONS'` | Yes |
| `RealtimeConfig.BACKPRESSURE_SAMPLES_PER_SEC` | `'WS_BACKPRESSURE_SAMPLES_PER_SEC'` | Yes |

All imports resolve to existing files. No new exports, no new modules, no runtime behavior change.

## Test results

4 of 5 test suites pass. 1 suite fails (**live.gateway.spec.ts** — 18 failures), all with:

```
TypeError: Cannot read properties of undefined (reading 'get')
  at new LiveGateway (live.gateway.ts:66:45)
```

### Root cause — pre-existing, NOT introduced by this changeset

Commit `b369453` (March 15) added `wsAuthMiddleware: WsAuthMiddleware` as constructor parameter 6, shifting `configService` to position 7. The spec file was never updated — it still passes 6 arguments, so `configService` is `undefined`.

The diff for this changeset only adds the `WsErrorCode` import and replaces string literals — it does not touch the constructor call at line 81. These tests were already broken before this work.

### Recommendation

Fix the constructor call in a follow-up (add `wsAuthMiddleware` mock at position 6). This is out of scope for the current refactoring task.

## Issues

No issues found in this changeset.

## Verdict

All changes are mechanical string-to-constant replacements. Each constant resolves to the exact same value. No logic changes, no new behavior, no security implications.

REVIEW_PASS
