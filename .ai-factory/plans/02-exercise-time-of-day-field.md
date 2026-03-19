# Plan: Exercise Time-of-Day Field

## Context
Add a nullable `timeOfDay` enum column (`morning | midday | evening`) to the `breath_sessions` table, wiring it through the entity, all DTOs, the seed script, and seed data.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Enum & Migration

- [x] **Task 1: Create TimeOfDay enum**
  Files: `src/breath-sessions/enums/time-of-day.enum.ts`
  Create a new file with a TypeScript enum following the existing pattern (see `src/users/interfaces/user-role.enum.ts`, `src/realtime/enums/session-status.enum.ts`):
  ```typescript
  export enum TimeOfDay {
    MORNING = 'morning',
    MIDDAY = 'midday',
    EVENING = 'evening',
  }
  ```

- [x] **Task 2: Create database migration** (depends on Task 1)
  Files: `src/migrations/<timestamp>-AddTimeOfDayToBreathSessions.ts`
  Generate migration via CLI: `npx typeorm migration:create src/migrations/AddTimeOfDayToBreathSessions`.
  In `up()`: create PG enum type `"public"."breath_sessions_timeOfDay_enum"` with values `('morning', 'midday', 'evening')`, then `ALTER TABLE "breath_sessions" ADD COLUMN "timeOfDay" "public"."breath_sessions_timeOfDay_enum" DEFAULT NULL`.
  In `down()`: drop the column, then drop the enum type.
  Follow the raw SQL pattern from `InitialSchema` and `AddLiveSession` migrations.

### Phase 2: Entity & DTOs

- [x] **Task 3: Add timeOfDay column to BreathSession entity** (depends on Task 1)
  Files: `src/breath-sessions/entities/breath-session.entity.ts`
  Import `TimeOfDay` enum. Add a new column after `shared`:
  ```typescript
  @ApiProperty({ enum: TimeOfDay, example: TimeOfDay.MORNING, nullable: true })
  @Column({ type: 'enum', enum: TimeOfDay, nullable: true, default: null })
  timeOfDay: TimeOfDay | null;
  ```
  Follow the same pattern used by `UserRole` in `src/users/entities/user.entity.ts` (`{ type: 'enum', enum: ... }`).

- [x] **Task 4: Add timeOfDay to DTOs** (depends on Task 1)
  Files: `src/breath-sessions/dto/breath-session.dto.ts`
  Import `TimeOfDay` enum. Add an optional `timeOfDay` field to three DTOs:
  - **`CreateBreathSessionDto`** — optional: `@ApiPropertyOptional({ enum: TimeOfDay })`, `@IsEnum(TimeOfDay)`, `@IsOptional()`, typed as `timeOfDay?: TimeOfDay`.
  - **`UpdateBreathSessionDto`** — optional: same decorators as Create.
  - **`ReplaceBreathSessionDto`** — optional with nullable: `@ApiPropertyOptional({ enum: TimeOfDay, nullable: true })`, `@IsEnum(TimeOfDay)`, `@IsOptional()`, typed as `timeOfDay?: TimeOfDay | null`. This allows PUT to explicitly set the field to null.

### Phase 3: Seed data

- [x] **Task 5: Add timeOfDay to seed script and seed data** (depends on Task 3)
  Files: `src/scripts/seed-breath-sessions.ts`, `src/scripts/breath-sessions.json`
  - In `seed-breath-sessions.ts`: add `timeOfDay` column to the minimal entity definition (as `@Column({ type: 'varchar', nullable: true })`), and include `timeOfDay: s.timeOfDay ?? null` in the record mapping.
  - In `breath-sessions.json`: add a `"timeOfDay"` field to each of the 100 session objects. Distribute values based on session description context (sessions mentioning "утро/утренн" → `"morning"`, "вечер/вечерн" → `"evening"`, "день/обед/пауза" → `"midday"`). Sessions without a clear time-of-day hint get `null`.
