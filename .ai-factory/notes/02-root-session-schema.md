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
1. `ActivityType` TS enum: add `ROOT = 'root'`.
2. Postgres enum type: `ALTER TYPE ... ADD VALUE 'root'`.
3. `ModuleSession` entity: add
   ```ts
   @Column({ type: 'uuid', nullable: true })
   rootSessionId: string | null;
   ```
   plus `@Index(['rootSessionId'])`.
4. FK `rootSessionId → module_sessions(id) ON DELETE CASCADE` (deleting a root removes its children — confirmed decision).
5. Generate migration via CLI: `npx typeorm migration:create src/migrations/AddRootSessionLink` (never hand-craft timestamp — see [[feedback_migrations]]).

### Proto note
Do **not** add `ROOT` to the proto `ActivityType` enum (`proto/module_state.proto`). Root sessions are created server-side, never via the client `activity_type` field; the proto mapper `mapProtoActivityType` must keep throwing on any non-breath/meditation value. Root stays an internal discriminator.

### Guards / gotchas
- Nullable column → all existing rows stay valid.
- `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block on older Postgres; if the migration runner wraps in a transaction, split the enum add into its own statement / migration or use the non-transactional form.
- `ON DELETE CASCADE` is self-referential on `module_sessions` — verify TypeORM emits the constraint correctly (the entity uses a plain `@Column`, not `@ManyToOne`, mirroring the existing userId pattern; add the FK in the migration SQL explicitly).

### Verify
- Migration up/down clean.
- Existing rows: `rootSessionId IS NULL`.
- Can insert a row with `activityType = 'root'` and another referencing it.

## Open Questions
- None — decisions locked (cascade, 1:1 model, no proto enum change).
