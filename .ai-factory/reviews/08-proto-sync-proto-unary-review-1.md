## Code Review Summary

**Files Reviewed:** 2 (proto/sync.proto, .ai-factory/ROADMAP.md)
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md:** WARN — no violations. Proto-only change, no NestJS module boundaries affected.
- **RULES.md:** WARN — no violations. No TypeScript code changed; no sensitive data or non-null assertions involved.
- **ROADMAP.md:** OK — sync.proto (unary) item correctly marked as `[x]`, matches the delivered contract.

### Analysis

**proto/sync.proto — unary portion (lines 1–63 at commit scope)**

Structure and conventions are consistent with every other proto in the project: `syntax = "proto3"; package mind;`, section banners, sequential field numbering from 1, DTO-suffix naming, and source-mapping comments.

**Field-by-field alignment with REST DTOs (`src/sync/dto/sync-changes.dto.ts`):**

| Proto field | Type | DTO field | Type | Match |
|---|---|---|---|---|
| `SyncEventDto.id` | `int64` | `id` | `number` | ✅ |
| `SyncEventDto.entity` | `string` | `entity` | `string` | ✅ |
| `SyncEventDto.ref_id` | `string` | `refId` | `string` | ✅ (snake→camel) |
| `SyncEventDto.action` | `string` | `action` | `string` | ✅ |
| `SyncEventDto.created_at` | `string` | `createdAt` | `Date` | ✅ (ISO-8601 string convention) |
| `SyncChangesPayload.events` | `repeated SyncEventDto` | `events` | `SyncEventDto[]` | ✅ |
| `SyncChangesPayload.cursor` | `int64` | `cursor` | `number` | ✅ |
| `SyncChangesPayload.has_more` | `bool` | `hasMore` | `boolean` | ✅ |
| `GetChangesRequest.after` | `int64` | `after` | `number` | ✅ |
| `GetChangesRequest.limit` | `int32` | `limit` | `number` | ✅ |

**`oneof result` in `GetChangesResponse`:** Correctly models the service return type (`SyncChangesResult | { fullResync: true }` in `sync.service.ts`). First unary `oneof` in the project — naming it `result` clearly differentiates from the streaming conventions (`command`/`event` in `live.proto`). Proto3 `oneof` provides explicit presence tracking, so consumers use the case discriminator (e.g., `whichResult()` in Dart) rather than the bool value itself — no ambiguity risk.

**Type choices:**
- `int64` for `id`, `cursor`, `after` — future-proofs beyond int32 range and matches roadmap spec. JS handles these safely up to 2^53, well beyond PostgreSQL SERIAL max.
- `string` for `entity` and `action` — deliberate extensibility choice; avoids proto-level coupling to `ChangeEntity`/`ChangeAction` enums, allowing new entity types without proto changes.
- `string` for `created_at` — ISO-8601 convention consistent with `BreathSessionDto` timestamps in `breath_sessions.proto`.

**Service definition:** `SyncService` with single `rpc GetChanges` — no naming collision with the NestJS `SyncService` class (different namespaces). Comment reserves space for future `WatchChanges` streaming RPC.

**ROADMAP.md:** Cosmetic reformatting of the sync items (moved `(unary)`/`(streaming)` inside bold markers) plus checkbox toggle. No functional impact.

### Positive Notes

- Proto faithfully mirrors the REST contract with zero drift — every field, type, and semantic matches.
- Clean use of `oneof` for the response branching pattern, with good comments explaining the naming decision relative to streaming conventions.
- Thorough source-mapping comments linking proto messages to their DTO counterparts.
- `int64` choice for IDs is forward-looking and consistent with the roadmap spec.

REVIEW_PASS
