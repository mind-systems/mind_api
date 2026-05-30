# Plan: Add `MEDITATION` to `ActivityType` enum — proto, TypeScript, and migration

## Context
Extend `ActivityType` to support a second activity kind (`MEDITATION`) alongside `BREATH`. Four touch points are required:

1. `proto/module_state.proto` — add the new enum member and regenerate stubs.
2. `src/realtime/enums/activity-type.enum.ts` — mirror the proto value as a TypeScript enum entry.
3. `src/realtime/module-state.grpc.controller.ts` — extend `mapProtoActivityType` so the gateway accepts `MEDITATION` (today it throws `INVALID_ARGUMENT` for anything other than `BREATH`).
4. `src/migrations/<timestamp>-AddMeditationActivityType.ts` — Postgres enum migration (`activityType` is a native `enum` column).

The realtime instruction engine and biometric stream are session-scoped and activity-type-agnostic — no changes needed there.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Assumptions / Notes
- **Postgres enum name correction.** The milestone description names the type `module_sessions_activitytype_enum`, but the actual Postgres type created by `InitialSchema1774863293946` is `public.activity_type_enum` (see `src/migrations/1774863293946-InitialSchema.ts` line 33 and the `module_sessions.activityType` column at line 264). The migration in this plan targets `"public"."activity_type_enum"`.
- **Enum value case.** Existing convention in both the TypeScript enum (`ActivityType.BREATH = 'breath'`) and the Postgres enum literal (`'breath'`) is **lowercase**. To stay consistent, the new value is added as Postgres literal `'meditation'` and TypeScript `MEDITATION = 'meditation'`. The proto-side identifier `MEDITATION` (uppercase, per protobuf convention) is independent from the wire/storage string — proto uses integer tags and `ts-proto` maps proto enum names to string identifiers in JSON, not to the TypeORM column value.
- **Gateway translation is not pass-through.** `mapProtoActivityType` in `src/realtime/module-state.grpc.controller.ts:33-41` is an explicit allow-list — currently only `ProtoActivityType.BREATH` is accepted; everything else (including `MEDITATION`, `ACTIVITY_TYPE_UNSPECIFIED`, `UNRECOGNIZED`) throws `INVALID_ARGUMENT`. The plan extends it to also accept `MEDITATION`. Without this change, the proto/TS/DB enums would all carry `MEDITATION` but the gateway would still reject any client request that uses it.
- **Stats are intentionally not extended.** `src/stats/stats.service.ts:101` gates complexity tracking on `activityType === ActivityType.BREATH && event.activityRefId`. Meditation sessions will silently skip that branch — correct for this milestone, since there is no `meditation_sessions` table or complexity model yet. A future roadmap item will introduce meditation-specific stats.
- **Migration transactionality.** `ALTER TYPE … ADD VALUE IF NOT EXISTS` is idempotent on retry. Postgres 12+ allows this inside a transaction provided the new value is not used in the same transaction (which this migration does not do). Initial attempt: rely on the default TypeORM-managed transaction. If a target Postgres version rejects it, set `transaction: false` on the migration class as a follow-up.
- **Entity drift.** `module-session.entity.ts` keeps `@Column({ type: 'enum', enum: ActivityType })`. Once `MEDITATION` is in the TS enum, the entity metadata and DB type stay aligned. No `synchronize` is ever run, so no surprise schema diffs.

## Tasks

### Phase 1: Proto contract

- [x] **Task 1: Add `MEDITATION = 2` to proto `ActivityType`**
  Files: `proto/module_state.proto`
  Insert `MEDITATION = 2;` directly after `BREATH = 1;` (line 15). Keep the existing comment about `ACTIVITY_TYPE_UNSPECIFIED = 0` being the sentinel. Update the trailing single-member comment (line 12, `Only one real member for now…`) to read `Extension point for future activity types.` so it no longer misleads.

- [x] **Task 2: Regenerate proto stubs** (depends on Task 1)
  Files: `proto/generated/**` (auto-generated)
  Run `npm run proto:gen`. Verify the regenerated `module_state` stub now contains `MEDITATION = 2` in the `ActivityType` enum. Do not hand-edit the generated file.

### Phase 2: TypeScript enum + gateway translation

- [x] **Task 3: Add `MEDITATION` to the TypeScript enum** (depends on Task 1)
  Files: `src/realtime/enums/activity-type.enum.ts`
  Add `MEDITATION = 'meditation',` after the existing `BREATH = 'breath',` line. Lowercase value preserves the existing convention and matches the Postgres enum literal added in Phase 3.

- [x] **Task 4: Extend `mapProtoActivityType` to accept `MEDITATION`** (depends on Tasks 2 and 3)
  Files: `src/realtime/module-state.grpc.controller.ts` (function at line 33)
  Convert the existing `if` chain into a `switch (proto)` with explicit cases for `ProtoActivityType.BREATH → InternalActivityType.BREATH` and `ProtoActivityType.MEDITATION → InternalActivityType.MEDITATION`. The `default` branch keeps the current `RpcException({ code: GrpcStatus.INVALID_ARGUMENT, message: \`Unsupported activity type: ${proto}\` })` so `ACTIVITY_TYPE_UNSPECIFIED` and `UNRECOGNIZED` still fail loudly. Optionally add `const _exhaustive: never = proto;` above the throw in `default` to get a compile-time error the next time a new proto value is added without updating this switch.

### Phase 3: Database migration

- [x] **Task 5: Generate the migration scaffold**
  Files: `src/migrations/<timestamp>-AddMeditationActivityType.ts` (new, name auto-stamped)
  Run `npx typeorm migration:create src/migrations/AddMeditationActivityType`. Do not hand-craft the timestamp.

- [x] **Task 6: Implement `up` and `down`** (depends on Task 5)
  Files: `src/migrations/<timestamp>-AddMeditationActivityType.ts`
  Implementation:
  - `up`: `await queryRunner.query(\`ALTER TYPE "public"."activity_type_enum" ADD VALUE IF NOT EXISTS 'meditation'\`);`
  - `down`: leave the method body empty except for a comment explaining that Postgres does not support `ALTER TYPE … DROP VALUE`; manual rollback would require dropping the type and recreating it without `'meditation'`, which requires rewriting every dependent column — out of scope for a no-op down.
  - Keep the class name as scaffolded by the CLI (`AddMeditationActivityType<timestamp>`).

### Phase 4: Apply and verify

- [x] **Task 7: Run the migration locally** (depends on Tasks 3, 6)
  Files: none (DB state)
  Run `npm run migration:run`. Verify the new value exists:
  ```
  psql … -c "SELECT unnest(enum_range(NULL::activity_type_enum));"
  ```
  Expected output includes both `breath` and `meditation`.

- [x] **Task 8: Type-check the build** (depends on Tasks 2, 3, 4)
  Files: none
  Run `npm run build` to confirm the regenerated proto stubs, the updated TS enum, and the new `switch` in `mapProtoActivityType` all compile together (the `_exhaustive: never` check, if added, will fail loudly if any proto value was missed). Run `npm run lint` to catch formatting drift in edited files.

## Commit Plan
- **Commit 1** (Tasks 1–4): "Add MEDITATION to ActivityType — proto, TS enum, and gateway mapping" — proto + regenerated stubs + TS enum + `mapProtoActivityType` switch land together, since the gateway change is what makes the new enum value actually usable end-to-end.
- **Commit 2** (Tasks 5–6): "Add migration adding meditation value to activity_type_enum"
- **Commit 3** (Tasks 7–8): only if any drift fix is needed after running migration/build; otherwise skip
