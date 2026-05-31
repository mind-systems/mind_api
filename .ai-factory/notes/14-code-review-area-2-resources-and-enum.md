# Code Review — Area 2: New resources & enum (Phases 16, 20, 22)

**Date:** 2026-05-31
**Source:** conversation context (full code read)

## Scope

- **Phase 16** — `BciDevice` resource (proto, migration, entity, service, gRPC controller, module)
- **Phase 20** — NFB Calibration History (proto, migration, entity, service, gRPC controller, module)
- **Phase 22** — `ActivityType.MEDITATION` (proto enum, TS enum, native-enum migration)

## Key Findings

- **All three phases are clean.** No correctness bugs. The pattern (proto → migration → entity → service → controller) is followed consistently; ownership/auth checks are in the right layer; null/empty mapping follows the project convention.
- **Phase 22 — implementer correctly diverged from the roadmap text.** The roadmap said to alter `module_sessions_activitytype_enum` and add value `'MEDITATION'` (uppercase). The real schema (InitialSchema:33) defines `CREATE TYPE "public"."activity_type_enum" AS ENUM('breath')` — a separate type name, lowercase values. The migration correctly does `ALTER TYPE "public"."activity_type_enum" ADD VALUE IF NOT EXISTS 'meditation'` and the TS enum is `MEDITATION = 'meditation'`. Had the roadmap text been followed literally, every meditation session insert would have failed with "invalid input value for enum". Good catch by the implementer.
- Several LOW/INFO observations below — none blocking.

## Details

### Phase 16 — BciDevice (clean)
- `register()` is genuinely idempotent and race-safe: `UPDATE … SET updated_at = CURRENT_TIMESTAMP WHERE (userId, serial)` then re-fetch on `affected > 0`; INSERT path catches Postgres `23505` (unique violation) and re-fetches without re-bumping. Correctly avoids the `@UpdateDateColumn`-not-moving trap.
- Ownership checks (`NOT_FOUND` / `PERMISSION_DENIED`) live in the service `delete()`, not the controller — matches the spec.
- Every RPC guards `user === null` → `UNAUTHENTICATED`. Mapper `toProtoBciDevice` converts `Date` → ISO. Dead `RegisterBciDeviceDto` removed (no `src/bci/dto/`).
- Migration: snake_case columns, `UQ_bci_devices_user_serial`, `IDX_bci_devices_user_id`, FK CASCADE to `users`. Entity matches.
- INFO: entity declares `@Index(['userId','serial'],{unique:true})` AND the migration creates `UQ_…` — redundant but harmless (`synchronize=false`, so the decorator never creates schema).

### Phase 20 — NFB Calibration History (clean)
- `record()` inserts unconditionally (immutable history, no upsert). `failReason: req.failReason || null` correctly maps proto3 empty-string → DB null. Mapper maps null → `''` back to proto. Round-trip convention correct.
- Entity numeric columns are `double precision`; migration columns are `double precision` — match (roadmap said `float`, which is the same type in Postgres).
- `IDX_nfb_calibration_records_user_device` on `(user_id, device_serial)`, FK CASCADE, no unique constraint (correct — every run is distinct).
- LOW: `record()` does `new Date(req.calibratedAt)` with no validation. An empty (proto3 default) or malformed `calibratedAt` produces `Invalid Date`, which fails the `NOT NULL timestamptz` insert with an opaque DB error rather than a clean `INVALID_ARGUMENT`. Consider validating before insert.
- INFO: `list()` was widened in Phase 21 so an empty `deviceSerial` skips the WHERE clause → returns ALL of the user's records across devices. The gRPC `list` passes `request.deviceSerial` (proto3 always-present, empty if unset), so a gRPC caller that omits the serial now gets every device's records. Still strictly user-scoped (no cross-user leak), so not a security issue — just a contract semantics shift for gRPC.

### Phase 22 — MEDITATION enum (clean)
- Three coordinated changes present: TS enum value, proto `MEDITATION = 2`, migration. `mapProtoActivityType` (module-state controller) maps both BREATH and MEDITATION and throws `INVALID_ARGUMENT` on UNSPECIFIED/UNRECOGNIZED with a compile-time exhaustiveness `never` check — robust.
- `down()` returns a rejected promise (loud failure) because Postgres can't `DROP VALUE` — deliberate and documented.
- INFO: `ALTER TYPE … ADD VALUE` must run on PostgreSQL 12+ to be allowed inside TypeORM's per-migration transaction. On <12 it would error. `IF NOT EXISTS` makes it idempotent. Assumed PG 12+ (timestamptz everywhere suggests a modern PG).

## Open Questions

- Phase 20: should `calibratedAt` be validated (clean `INVALID_ARGUMENT`) rather than letting an invalid date hit the DB?
- Phase 20: is the gRPC `list` "empty serial → all devices" behavior intended, or should gRPC keep requiring a non-empty serial?
