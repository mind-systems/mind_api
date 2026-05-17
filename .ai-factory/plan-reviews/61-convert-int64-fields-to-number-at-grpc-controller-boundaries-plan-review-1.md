## Plan Review Summary

**Files Covered:** 3
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md:** WARN — no boundary violation. The plan keeps coercion at the controller layer and explicitly forbids changes to `SyncService` / `ChangeLogService` / `StreamEngine`, which matches the "Controllers are thin / business logic in services" guideline (entities aren't touched, only the request DTO at the edge).
- **RULES.md:** WARN — no rule violation. No non-null assertions, no sensitive data logged, no log spam added, and the `@Payload()`-on-gRPC-method rule is already satisfied in all three target controllers.
- **ROADMAP.md:** WARN — the plan does not explicitly cross-reference a roadmap entry. This is a `fix`-class change (samples jsonb corruption + `invalid input syntax for type integer` runtime crash); consider adding a one-liner under the active phase so the fix is traceable.

### Codebase Verification

All cited line numbers and surrounding code match the current sources:

| File | Plan says | Verified |
|------|-----------|----------|
| `src/sync/sync.grpc.controller.ts` line 26 | `syncService.getChanges(user.sub, request.after, request.limit)` | ✅ Confirmed call site at that line |
| `src/realtime/sync-stream.grpc.controller.ts` line 75 | `if (request.afterId === undefined) { ... return; }` short-circuit | ✅ Confirmed (lines 74–79) |
| `src/realtime/sync-stream.grpc.controller.ts` line 81 | `let cursor = request.afterId;` | ✅ Confirmed |
| `src/realtime/sync-stream.grpc.controller.ts` line 84 | `cursor < minEventId` comparison | ✅ Confirmed |
| `src/realtime/sync-stream.grpc.controller.ts` line 100 | `changeLogService.getChanges(userId, cursor, 100)` | ✅ Confirmed |
| `src/realtime/module-instruction-stream.grpc.controller.ts` line 103 | `timestamp: msg.timestamp,` inside `streamEngine.push(...)` | ✅ Confirmed |

A repo-wide search for proto `int64` fields turns up six declarations across three proto files:

| Proto field | Direction | Covered? |
|---|---|---|
| `GetChangesRequest.after` | inbound (client → server) | ✅ Task 1 |
| `WatchChangesRequest.after_id` | inbound | ✅ Task 2 |
| `StreamSample.timestamp` | inbound (bidi stream client side) | ✅ Task 3 |
| `SyncEventDto.id`, `SyncChangesPayload.cursor` | outbound | n/a — server emits a JS `number` straight from the DB; proto-loader encodes `number → int64` cleanly within `Number.MAX_SAFE_INTEGER`. No leak. |
| `StreamAck.received_count`, `dropped_count`, `timestamp` | outbound | n/a — built from `Date.now()` / counters that are already `number`. No leak. |
| `StateErrorEvent.timestamp` | outbound only in this repo | n/a — only constructed from `Date.now()` (see `module-state.grpc.controller.ts` and `module-instruction-stream.grpc.controller.ts`). No leak. |

There are no other inbound `int64`-typed reads of `request.*`, `msg.timestamp`, etc. that would silently leak `Long` objects past a controller — `grep -n 'request\\.(after|afterId|timestamp)|msg\\.timestamp' src/` returns exactly the three sites the plan addresses.

### Correctness Notes

- The root-cause story is accurate. `@nestjs/microservices` boots the gRPC transport without an explicit `loader: { longs: ... }` option in `src/main.ts`, so `@grpc/proto-loader` falls back to its default (`longs: undefined`), which yields runtime `Long` objects even though ts-proto's generated interfaces type those fields as `number`. The downstream symptoms — PG `invalid input syntax for type integer` for `getChanges` and the `{"low":N,"high":N,"unsigned":false}` blob landing in `session_stream_samples.samples` — both flow from that mismatch.
- `Number(longObj)` is sound: `Long.prototype.valueOf()` returns `this.toNumber()`, so `Number(...)` is equivalent to `toNumber()` and produces a plain JS number. Equally important, `Number(0n-shaped Long)` returns `0` (not `NaN`), so the `cursor !== 0 && cursor < minEventId` check at line 84 still behaves correctly when the client sends `after_id = 0`.
- Task 2 is right to keep `if (request.afterId === undefined)` above the coercion. `Number(undefined) === NaN`, and `NaN < minEventId` is `false` while `NaN !== 0` is `true`, which would silently let the stream proceed with a nonsense cursor instead of taking the "live-only" path. Worth keeping that ordering invariant in mind if anyone later refactors this block.
- The plan does not change `result.cursor`, `result.events[i].id`, or `cursor = result.cursor` reassignments inside `watchChanges`. That's fine: those values originate from `ChangeLogService` (PG via TypeORM), which already yields JS numbers, never `Long`.

### Suggestions (non-blocking)

1. **Consider the global alternative.** A single-point fix is available: set `loader: { longs: Number }` (or `String` if you want lossless precision for very large IDs) on the gRPC microservice options in `src/main.ts`. That removes the per-call-site discipline forever — any future proto `int64` field would be deserialized correctly without further code changes. The plan's per-boundary approach is acceptable (smaller blast radius, easier to revert), but the alternative deserves a one-line note in the plan's *Context* section explaining why it was rejected (e.g. "we don't want to silently downgrade IDs past 2^53"). Without that note, the next developer touching an `int64` field will repeat the same surgical fix instead of solving it at the loader.
2. **Precision footnote.** `Number(Long)` lossy-converts past 2^53. Sync event auto-increment IDs and Unix-millis timestamps stay safe for decades, but the plan should explicitly call out that this is the conscious trade-off (vs. `longs: String` + `parseInt`). One sentence under *Context* is enough.
3. **Roadmap traceability.** Add a one-line `[ ]` entry under the active phase in `ROADMAP.md` ("Fix int64 → number coercion at gRPC controller boundaries") so this defect is grep-able from the roadmap, consistent with how prior fixes have been tracked.
4. **Settings: `Logging: minimal`.** No new logs are introduced, which matches the *Keep logs lean* rule. Good. (No change requested — just confirming.)

### Critical Issues

None. The three coercions are necessary, correctly placed, and exhaustively cover the inbound `int64` surface.

### Positive Notes

- The plan correctly diagnoses the ts-proto-vs-proto-loader gap rather than papering over symptoms in the service layer.
- It explicitly forbids changes to `SyncService` / `ChangeLogService` / `StreamEngine`, preserving the "controllers are thin and own boundary translation" architectural rule.
- It calls out the subtle `undefined` short-circuit ordering in Task 2 instead of leaving it as an implicit invariant — that's exactly the kind of footgun that would otherwise surface as a regression six months later.

PLAN_REVIEW_PASS
