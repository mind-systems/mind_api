# Root session schema foundation (rootSessionId + root activity type)

**Date:** 2026-06-28
**Source:** conversation context

## Key Findings

- The continuous-bio-timeline refactor needs one additive schema change before any behavior changes: a self-referencing parent link on `module_sessions` and a new `root` activity type. Pure foundation — compiles, breaks nothing, no runtime behavior.
- Two-level model only: `rootSessionId` (no `parentSessionId`). Root rows have `rootSessionId = null`; activity rows point at their root.

## Details

### Current state
- `src/realtime/entities/module-session.entity.ts` — `ModuleSession` has no parent linkage. `activityType` is a NOT NULL enum column.
- `src/realtime/enums/activity-type.enum.ts` — `ActivityType { BREATH = 'breath', MEDITATION = 'meditation' }`. Backed by a Postgres enum type (created in `InitialSchema`, extended by `1780146744056-AddMeditationActivityType`).
- `@Index(['userId'])` and `@Index(['status'])` already present.

### Change
1. `ActivityType` TS enum (`src/realtime/enums/activity-type.enum.ts:1-4`): add `ROOT = 'root'`. Current members: `BREATH = 'breath'`, `MEDITATION = 'meditation'`.
2. Postgres enum type — exact statement, mirroring `AddMeditationActivityType` (`src/migrations/1780146744056-AddMeditationActivityType.ts:5-7`). The enum type name is `"public"."activity_type_enum"` (created in `InitialSchema` at `src/migrations/1774863293946-InitialSchema.ts:33` as `ENUM('breath')`, extended with `'meditation'`):
   ```sql
   ALTER TYPE "public"."activity_type_enum" ADD VALUE IF NOT EXISTS 'root'
   ```
   `down()` must reject with an Error (Postgres has no `DROP VALUE`) — copy the exact reject pattern from `AddMeditationActivityType.ts:10-22`.
3. `ModuleSession` entity (`src/realtime/entities/module-session.entity.ts`): add after the `userId` column (line 20-21), following the existing nullable-uuid `activityRefId` shape at line 26-27:
   ```ts
   // No @ManyToOne — modules stay decoupled at the ORM level (mirrors userId, line 18-20).
   // Self-referential FK constraint enforced in the migration, not via @ManyToOne.
   @Column({ type: 'uuid', nullable: true })
   rootSessionId: string | null;
   ```
   Add class-level `@Index(['rootSessionId'])` next to the existing `@Index(['userId'])` / `@Index(['status'])` at lines 12-13.
4. FK `rootSessionId → module_sessions(id) ON DELETE CASCADE` (deleting a root removes its children — confirmed decision). Add the column + constraint in the migration with raw SQL matching the InitialSchema style (`src/migrations/1774863293946-InitialSchema.ts:273-274,293`):
   ```sql
   ALTER TABLE "module_sessions" ADD COLUMN "rootSessionId" uuid DEFAULT NULL;
   ALTER TABLE "module_sessions"
     ADD CONSTRAINT "FK_module_sessions_rootSessionId"
     FOREIGN KEY ("rootSessionId") REFERENCES "module_sessions"("id") ON DELETE CASCADE;
   CREATE INDEX "IDX_module_sessions_rootSessionId" ON "module_sessions" ("rootSessionId");
   ```
   Index name follows the existing convention `IDX_module_sessions_<col>` (`InitialSchema.ts:278,281`).
5. Generate migration via CLI: `npx typeorm migration:create src/migrations/AddRootSessionLink` (never hand-craft timestamp — see [[feedback_migrations]]).

### In-memory interface (foundation only)
`ActivityState` (`src/realtime/interfaces/activity-state.interface.ts:3-10`) currently has fields `sessionId`, `activityType`, `activityRefId?`, `startedAt`, `lastActivityAt`, `isPaused`. Add the optional field here so the store/engine refactor ([[03-multi-session-store-engine]]) and lazy-root ([[04-lazy-root-creation]]) can carry the link in memory:
```ts
rootSessionId?: string | null;
```
No runtime behavior change — purely additive.

### Proto note
Do **not** add `ROOT` to the proto `ActivityType` enum (`proto/module_state.proto`). Root sessions are created server-side, never via the client `activity_type` field; the proto mapper `mapProtoActivityType` must keep throwing on any non-breath/meditation value. Root stays an internal discriminator.

### Guards / gotchas
- Nullable column → all existing rows stay valid.
- **Transaction wrapping confirmed:** neither `database.config.ts` nor `src/config/typeorm.config.ts` sets `migrationsTransactionMode`, so TypeORM defaults to `"all"` — each migration runs **inside a transaction**. `ALTER TYPE ... ADD VALUE` is allowed inside a transaction on Postgres 12+ **as long as the new value is not used within the same transaction** — this is exactly why `AddMeditationActivityType` works as a single-statement migration. Therefore: the `ALTER TYPE ... ADD VALUE 'root'` must live in its OWN migration that does nothing else (no INSERT/UPDATE using `'root'`, no `'root'` in the same tx). Put the column + FK + index in a SEPARATE later migration (or keep the enum-add migration first and the schema migration second). Do NOT combine `ADD VALUE 'root'` and any write of a `'root'` row in one migration.
- `ON DELETE CASCADE` is self-referential on `module_sessions` — the entity uses a plain `@Column`, not `@ManyToOne` (mirrors the `userId` pattern at `module-session.entity.ts:18-21`). TypeORM will NOT emit a self-FK from a plain `@Column`, so the FK MUST be written explicitly in raw migration SQL (see Change step 4).

### Verify
- Migration up/down clean.
- Existing rows: `rootSessionId IS NULL`.
- Can insert a row with `activityType = 'root'` and another referencing it.

## Open Questions
- None — decisions locked (cascade, 1:1 model, no proto enum change).
