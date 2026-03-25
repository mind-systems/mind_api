# Plan: live.proto — rename ActivityType.BREATH_SESSION → BREATH

## Context
Rename the `BREATH_SESSION` enum member to `BREATH` in the proto contract and all downstream TypeScript code. The old name conflicted with the modular architecture — it names the module rather than the activity kind. `BREATH` aligns with how `module_id` is expressed in telemetry (`"breath"`).

**Scope:** `mind_api` only. Consumer repos (`mind_mcp`, `mind_mobile`) will copy the updated proto and regenerate stubs separately.

**Important:** `ChangeEntity.BREATH_SESSION` in `src/changelog/changelog.enums.ts` is a completely separate enum (sync entity type) and must NOT be touched by this change.

## Settings
- Testing: no
- Logging: minimal
- Docs: no (docs already use `breathing` / `breath_session` only for `activityRefType`, not `ActivityType`)

## Tasks

### Phase 1: Contract & enum

- [x] **Task 1: Rename proto enum value**
  Files: `proto/live.proto`
  Rename `BREATH_SESSION = 1` → `BREATH = 1` (line 15). The numeric tag stays the same — this is a name-only change. Update the preceding comment (line 12) to replace "Only one real member" wording if it references `BREATH_SESSION`.

- [x] **Task 2: Rename TypeScript enum key and string value**
  Files: `src/realtime/enums/activity-type.enum.ts`
  Change `BREATH_SESSION = 'breath_session'` → `BREATH = 'breath'`. Both key and stored value change — the new string `'breath'` matches the telemetry `module_id` convention.

### Phase 2: Database migration

- [x] **Task 3: Create migration to rename PostgreSQL enum value** (depends on Task 2)
  Files: `src/migrations/<TimestampFromCLI>-RenameActivityTypeBreathSessionToBreath.ts`
  Generate via CLI: `npx typeorm migration:create src/migrations/RenameActivityTypeBreathSessionToBreath`. Inside the migration:
  - `up`: `ALTER TYPE "public"."activity_type_enum" RENAME VALUE 'breath_session' TO 'breath'`
  - `down`: `ALTER TYPE "public"."activity_type_enum" RENAME VALUE 'breath' TO 'breath_session'`

  Do NOT edit the original migration `1773469567000-AddLiveSession.ts`.

### Phase 3: Update references in specs

- [x] **Task 4: Update all spec files** (depends on Task 2)
  Files: `src/realtime/services/activity-engine.service.spec.ts`, `src/realtime/gateways/live.gateway.spec.ts`, `src/realtime/gateways/telemetry.gateway.spec.ts`, `src/realtime/services/startup-recovery.service.spec.ts`
  Replace every `ActivityType.BREATH_SESSION` with `ActivityType.BREATH` across all four spec files (~22 occurrences total). No logic changes — purely mechanical rename.
