# Plan Review: Migration AddMeditationNotesTable

**Plan:** `.ai-factory/plans/42-migration-addmeditationnotestable.md`
**Files Reviewed:** plan + 4 migrations + 1 entity for convention baseline
**Risk Level:** 🟢 Low

The plan is technically sound and will produce a working migration. The SQL is valid Postgres, the
`uuid_generate_v4()` default and `uuid-ossp` extension are already established by `InitialSchema`, both
referenced parent tables (`users`, `module_sessions`) exist with `uuid` PKs, and the design decisions
(`ON DELETE SET NULL` on a nullable `session_id`, partial unique index for one-note-per-session) are
correct and match the stated intent. The CLI-generated-timestamp rule from `CLAUDE.md` is respected.

No critical/blocking issues. The findings below are non-blocking advisories worth folding in before
implementation.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** `WARN` — no boundary violation in this plan (it is a
  pure migration with no module wiring). Note for the follow-up: per the modular-monolith rule, the
  eventual `MeditationNote` entity and its `@InjectRepository` must be confined to a single owning module.
- **Rules (`.ai-factory/RULES.md`):** No explicit convention rules matched; nothing to enforce.
- **Roadmap (`.ai-factory/ROADMAP.md`):** `WARN` — there is no ROADMAP entry for `meditation_notes` /
  meditation notes. This is likely `feat` work; add a milestone line so the table's purpose and the
  follow-up (entity + module + endpoint) are tracked.

## Findings (non-blocking)

### 1. `WARN` — Contradictory column-naming reference
Task 2 instructs the implementer to follow `AddBioSessionSamplesTable.ts`, but that migration (and all
realtime tables: `module_sessions`, `session_stream_samples`, `bio_session_samples`) uses **camelCase**
columns (`moduleSessionId`, `createdAt`) with no `@Column({ name })` mapping. The plan itself specifies
**snake_case** columns (`user_id`, `session_id`, `pose_name`, `note_text`, `created_at`, `updated_at`).

The snake_case choice is itself fine — it matches the newer `bci_devices` table
(`AddBciDevicesTable.ts`: `user_id`, `created_at`, `updated_at`). But the *cited pattern* is the wrong
one for column style. Only the structural conventions (double-quoted identifiers, named PK/FK/index
constraints) transfer from `bio_session_samples`; the column casing does not.

**Recommendation:** cite `src/migrations/1779369537954-AddBciDevicesTable.ts` as the column-style
reference and keep `bio_session_samples` only for the constraint-naming style — or state explicitly
"snake_case columns (bci_devices style), named constraints (bio_session_samples style)".

### 2. `WARN` — No global naming strategy; future entity needs explicit name mappings
There is no `SnakeNamingStrategy` configured in `database.config.ts`; TypeORM defaults to property-name =
column-name. With snake_case columns chosen here, the eventual `MeditationNote` entity **must** use
explicit `@Column({ name: 'session_id' })`, `@CreateDateColumn({ name: 'created_at' })`, etc., exactly
like `src/bci/entities/bci-device.entity.ts`. If the implementer later mirrors `bio-session-sample.entity.ts`
(no `name:` mappings), the entity will silently look for camelCase columns that don't exist.

This plan is migration-only, so it is not a defect here — but add a one-line note so the follow-up entity
plan doesn't trip on it.

### 3. Minor — Redundant `DROP INDEX` in `down`
Task 3 drops the three indexes before `DROP TABLE`. `DROP TABLE` already removes its own indexes and FKs,
so the explicit `DROP INDEX IF EXISTS` calls are harmless but redundant (compare `AddBciDevicesTable.ts`,
whose `down` just drops the table). Acceptable to keep for explicitness; flagging only for awareness.

## Positive Notes

- Correct, intent-matching use of `ON DELETE SET NULL` on a nullable `session_id` so notes survive session
  deletion, paired with `ON DELETE CASCADE` on `user_id`.
- Partial unique index `WHERE "session_id" IS NOT NULL` is exactly the right tool for "one note per live
  session, multiple detached notes allowed" — a non-obvious detail that is correctly specified.
- Named PK/FK/index constraints follow the established project style.
- Task 4 includes concrete verification steps (`\d meditation_notes`, rollback round-trip).
- Honors the "never hand-craft migration timestamps — use the CLI" rule.

## Verdict

Solid, low-risk plan. Address findings #1 and #2 (wording/reference clarifications — no SQL change) and
add the ROADMAP linkage, then proceed.
