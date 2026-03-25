# Review: proto/sync.proto (unary)

## Files reviewed

| File | Verdict |
|------|---------|
| `proto/sync.proto` | OK |
| `.ai-factory/ROADMAP.md` | OK (cosmetic) |
| `.ai-factory/plans/08-proto-sync-proto-unary.md` | OK |

## proto/sync.proto

**Structure & conventions** — matches project patterns exactly: `syntax = "proto3"; package mind;`, section banners, sequential field numbering, DTO-suffix naming (`SyncEventDto`), source-mapping comments. Consistent with `stats.proto`, `device.proto`, `breath_sessions.proto`.

**`oneof result` in `GetChangesResponse`** — correct. First unary `oneof` in the project (existing `oneof` usage is in streaming envelopes in `live.proto` / `telemetry.proto`). The name `result` is well-chosen to differentiate from the streaming conventions (`command`, `event`). Proto3 `oneof` fields have explicit presence tracking, so the receiver can always distinguish `payload` from `full_resync` via the case discriminator.

**Field types:**
- `id`, `cursor`, `after` as `int64` — correct. The DB column is `SERIAL` (int4, max ~2.1B), but `int64` future-proofs and matches the roadmap spec. JavaScript handles `int64` as `number` safely up to 2^53, well beyond SERIAL range.
- `limit` as `int32` — matches the DTO constraint (1–100).
- `created_at` as `string` (ISO-8601) — consistent with `BreathSessionDto` timestamps. The DTO's `Date` type serializes to ISO-8601.
- `entity`, `action` as `string` — matches the existing DTO and avoids tight proto-level coupling to the `ChangeEntity`/`ChangeAction` enums, allowing new entity types without proto changes.

**`ref_id` casing** — snake_case in proto, maps to `refId` in the DTO. Standard proto3 convention; generated code handles the transformation.

**Service name `SyncService`** — no collision with the NestJS `SyncService` class; proto services and TS classes live in different namespaces. Consistent with `StatsService`, `AuthService`, etc.

**Future extensibility** — the service definition comment reserves space for the `WatchChanges` streaming RPC. The `SyncEventDto` and `SyncChangesPayload` messages are in the shared types section, ready for reuse by the streaming response.

## .ai-factory/ROADMAP.md

Cosmetic change only — moved `(unary)` and `(streaming)` inside the bold markers for the sync.proto items. No functional impact.

## No issues found

REVIEW_PASS
