# Code Review: Convert `int64` fields to `number` at gRPC controller boundaries

**Scope reviewed:** the three TypeScript controller edits (`src/sync/sync.grpc.controller.ts`, `src/realtime/sync-stream.grpc.controller.ts`, `src/realtime/module-instruction-stream.grpc.controller.ts`). Plan/plan-review/ROADMAP changes inspected for context but not gated on.

## Diff summary

All three changes are single-line `Number(...)` coercions at the exact boundary the plan describes:

| File | Line | Change |
|------|------|--------|
| `src/sync/sync.grpc.controller.ts` | 26 | `request.after` → `Number(request.after)` in the `syncService.getChanges(...)` call |
| `src/realtime/sync-stream.grpc.controller.ts` | 81 | `let cursor = request.afterId` → `let cursor = Number(request.afterId)` |
| `src/realtime/module-instruction-stream.grpc.controller.ts` | 103 | `timestamp: msg.timestamp` → `timestamp: Number(msg.timestamp)` in the `streamEngine.push(...)` literal |

## Correctness analysis

### Root cause matches the actual runtime config

`src/main.ts:55-71` registers the gRPC microservice with `Transport.GRPC` and `protoPath: [...]` but does **not** pass `loader: { longs: ... }`. `@grpc/proto-loader` therefore uses its default, which deserializes proto `int64` fields as `Long` objects (`{ low, high, unsigned }`). ts-proto's generated interfaces type these as `number`, so the mismatch is invisible at compile time and surfaces only at runtime — confirming the plan's diagnosis.

### Task 1 — `sync.grpc.controller.ts` ✅

`GetChangesRequest.after` is a non-optional `int64` (proto3, `proto/sync.proto:37`). With proto-loader defaults, an unset field comes through as `Long(0)`, not `undefined`, so `Number(request.after)` is always a finite integer (never `NaN`). `ChangeLogService.getChanges` declares `afterId: number` and binds it as TypeORM SQL parameter `$2`; the coercion eliminates the `invalid input syntax for type integer` Postgres error. No side effects on `SyncService` or `ChangeLogService`.

### Task 2 — `sync-stream.grpc.controller.ts` ✅

`WatchChangesRequest.after_id` is `optional int64` (`proto/sync.proto:58`). With proto3 `optional`, proto-loader returns `undefined` for an absent field — that's why the pre-existing `if (request.afterId === undefined)` short-circuit at line 75 is meaningful and remains above the coercion at line 81. Order of operations is preserved exactly as the plan calls out, so the live-only mode is not accidentally turned into a `NaN`-cursor replay.

Downstream invariants hold:
- Line 84 `cursor !== 0 && cursor < minEventId` — `minEventId` comes from `parseInt(...)` in `ChangeLogService.getMinEventId()` (`changelog.service.ts:89`), so both operands are now plain numbers; comparison is well-defined.
- Line 100 `changeLogService.getChanges(userId, cursor, 100)` — `cursor` is now a number, matching the declared `afterId: number`.
- Line 113-114 `cursor = result.cursor; lastReplayedCursor = result.cursor;` — `result.cursor` is sourced from a JS-side `number` already, so subsequent loop iterations stay number-typed.

If a client explicitly sends `after_id = 0`, proto-loader yields `Long(0)` (not `undefined`); `Number(Long(0)) === 0`, the staleness check is skipped (`cursor !== 0` false), and `getChanges` correctly replays from the start. Documented proto behavior is preserved.

### Task 3 — `module-instruction-stream.grpc.controller.ts` ✅

`StreamSample.timestamp` is non-optional `int64` (`proto/module_instruction_stream.proto:22`). `StreamEngine.push` accepts `InstructionSample`, whose `timestamp: number` is declared in `src/realtime/interfaces/session-buffer.interface.ts:2`. The coercion makes the in-memory `InstructionSample` and the eventual `session_stream_samples.samples` jsonb store a plain Unix-millis integer instead of the `{"low":N,"high":N,"unsigned":false}` blob. The other three fields in the literal (`moduleId`, `instructionType`, `data`) are strings or `Struct` and need no coercion.

## Coverage of inbound `int64` surface

`grep -n 'int64' proto/*.proto` enumerates every `int64` declaration in the repo. Classifying by direction:

| Field | Direction | Status |
|-------|-----------|--------|
| `GetChangesRequest.after` | inbound | covered (Task 1) |
| `WatchChangesRequest.after_id` | inbound | covered (Task 2) |
| `StreamSample.timestamp` | inbound | covered (Task 3) |
| `SyncEventDto.id`, `SyncChangesPayload.cursor` | outbound | constructed from DB numbers; proto-loader serializes `number → int64` cleanly under `Number.MAX_SAFE_INTEGER`. No leak. |
| `StreamAck.received_count`, `dropped_count`, `timestamp` | outbound | constructed from JS counters / `Date.now()`. No leak. |
| `StateErrorEvent.timestamp` | outbound | constructed from `Date.now()`. No leak. |

No inbound `int64` field is missed.

## Runtime concerns

- **Precision:** `Number(Long)` lossy-converts past 2^53 (≈ 9.0e15). Sync event auto-increment IDs start at 1 and Unix-millis timestamps stay safe until year 287,396 — both well within the safe range. Acceptable trade-off for the simpler boundary fix vs. the loader-level `longs: String` alternative.
- **No migrations, schema, or service-layer changes** — the boundary is correctly drawn at the controller and nothing downstream needs to know about the Long-vs-number distinction anymore.
- **No new logs, no log spam, no sensitive data leaks** — the coercions are pure value transforms.
- **No race conditions introduced** — the order-of-operations invariant in Task 2 (`undefined` short-circuit *before* `Number(...)`) is the only sequencing concern, and it is respected.

## Minor observations (non-blocking)

1. The same defect class could be neutralized once-for-all by setting `loader: { longs: Number }` on the gRPC microservice in `src/main.ts`. The per-boundary fix is fine and has a smaller blast radius, but a future developer adding any new inbound `int64` field will silently reintroduce the bug. Worth a follow-up tracking ticket if the team prefers the loader-level fix.
2. `StreamSample.timestamp` defaults to `Long(0)` when a client omits it, which after coercion becomes the literal integer `0` in the persisted sample. This is strictly better than the previous `{"low":0,"high":0,...}` blob, but it does mean clients that "forget" to set a timestamp now persist a meaningful-looking `0` rather than a visibly-broken object. Unlikely to matter in practice, but flagging in case downstream analytics treats `timestamp === 0` as a real event time.

## Verdict

All three coercions are necessary, correctly placed, type-safe, and exhaustive over the inbound `int64` surface. No bugs, no security issues, no migration gaps, no test/runtime regressions introduced.

REVIEW_PASS
