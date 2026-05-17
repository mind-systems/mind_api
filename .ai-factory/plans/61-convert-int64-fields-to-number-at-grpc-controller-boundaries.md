# Plan: Convert `int64` fields to `number` at gRPC controller boundaries

## Context
`@grpc/grpc-js` deserializes `int64` proto fields as `Long` objects at runtime (NestJS loads `.proto` via `@grpc/proto-loader` and bypasses the ts-proto `requestDeserialize` hooks), but ts-proto's TypeScript interfaces type them as `number`. The mismatch reaches PostgreSQL (`getChanges` crashes with `invalid input syntax for type integer`), corrupts a replay-cursor comparison in `watchChanges`, and silently writes `{"low":0,"high":0,"unsigned":false}` instead of a Unix-millis integer into the `samples` jsonb in `session_stream_samples`. Fix: coerce each `int64`-sourced field to `number` at the controller boundary; no service-layer changes.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Controller-level coercion

- [x] **Task 1: Coerce `request.after` in `SyncGrpcController.getChanges`**
  Files: `src/sync/sync.grpc.controller.ts`
  At line 26, wrap `request.after` with `Number(...)` when passing it to `this.syncService.getChanges(...)`. The call becomes `this.syncService.getChanges(user.sub, Number(request.after), request.limit)`. This eliminates the `Long` object before it reaches `ChangeLogService.getChanges()` → TypeORM SQL parameter `$2`, which currently triggers `invalid input syntax for type integer`. Do not modify `SyncService` or `ChangeLogService`.

- [x] **Task 2: Coerce `request.afterId` in `SyncStreamGrpcController.watchChanges`**
  Files: `src/realtime/sync-stream.grpc.controller.ts`
  At line 81, change `let cursor = request.afterId;` to `let cursor = Number(request.afterId);`. This ensures the staleness comparison `cursor < minEventId` at line 84 performs numeric comparison (not Long-vs-number, which currently coerces unpredictably) and that the value passed to `this.changeLogService.getChanges(userId, cursor, 100)` at line 100 is a plain number. The `undefined` short-circuit at line 75 (`if (request.afterId === undefined)`) must remain above the coercion so live-only mode is preserved — `Number(undefined)` would otherwise become `NaN`.

- [x] **Task 3: Coerce `msg.timestamp` in `ModuleInstructionStreamGrpcController.streamData`**
  Files: `src/realtime/module-instruction-stream.grpc.controller.ts`
  At line 103, in the object literal passed to `this.streamEngine.push(msg.sessionId, { ... })`, change `timestamp: msg.timestamp,` to `timestamp: Number(msg.timestamp),`. This ensures the stored value in `session_stream_samples.samples` (jsonb) is a Unix-millisecond integer rather than the serialized `Long` shape `{"low":N,"high":N,"unsigned":false}`. Do not modify `StreamEngine`.
