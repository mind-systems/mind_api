# Plan Review 2: Migration AddMeditationNotesTable

**Plan:** `.ai-factory/plans/42-migration-addmeditationnotestable.md`
**Files Reviewed:** plan + `InitialSchema` (users, module_sessions) + `AddBioSessionSamplesTable` (cited pattern) + `AddBciDevicesTable` baseline + ROADMAP Phase 30 + `proto/meditation_notes.proto` (contract alignment)
**Risk Level:** 🟢 Low

This is a migration-only plan and it is correct, complete, and matched to the codebase. All SQL is valid
Postgres, both parent tables (`users`, `module_sessions`) exist with `uuid` PKs, the `uuid_generate_v4()`
default and `uuid-ossp` extension are already established by `InitialSchema`, and the schema exactly
mirrors the ROADMAP Phase 30 spec (line 147) and the snake_case wire fields in `proto/meditation_notes.proto`
(`session_id`, `pose_name`, `note_text`).

The two design-critical decisions are right and explicitly called out: `ON DELETE SET NULL` on the
nullable `session_id` (so notes survive session deletion — the core requirement), paired with
`ON DELETE CASCADE` on `user_id`, and the partial unique index `WHERE "session_id" IS NOT NULL` to
enforce one note per live session while allowing multiple detached (null) notes.

No critical/blocking issues. Review-1's two main advisories are now effectively resolved.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** Pass for this plan — it is a pure migration with no
  module wiring, so no modular-monolith boundary applies yet. (Carry-forward note, not a defect here:
  the follow-up `MeditationNote` entity + `@InjectRepository` must stay confined to `MeditationNotesModule`
  per ROADMAP line 149.)
- **Rules (`.ai-factory/RULES.md`):** No explicit convention rule matched. CLAUDE.md's "never hand-craft
  migration timestamps — use the CLI" rule is honored (Task 1).
- **Roadmap (`.ai-factory/ROADMAP.md`):** Pass — Phase 30 line 147 (`Migration AddMeditationNotesTable`)
  is the exact tracked milestone, and the plan's columns/indexes/FK rules match it line-for-line. The
  roadmap WARN from review-1 is resolved (the entry exists and is linked).

## Findings (non-blocking)

### 1. Minor — Cited pattern scoped correctly; column-style reference still implicit
Task 2 cites `AddBioSessionSamplesTable.ts` but now scopes the citation to "(double-quoted identifiers,
named PK/FK/index constraints)" — i.e. structural conventions only. That addresses review-1's concern,
since the cited table uses camelCase columns while this plan correctly uses snake_case. For zero
ambiguity, the implementer could additionally glance at `AddBciDevicesTable.ts` as the snake_case
column-casing precedent (`user_id`, `created_at`, `updated_at`), but this is optional polish — the column
list in Task 2 is fully explicit, so there is no real room for error.

### 2. Minor — `updated_at` has no auto-update mechanism (by design, fine)
The table defines `updated_at timestamptz DEFAULT now()` but no `BEFORE UPDATE` trigger (unlike
`breath_sessions`). This is consistent with `bci_devices`/`user_stats`, which rely on the entity's
`@UpdateDateColumn` to maintain the value. The follow-up entity (ROADMAP line 149) must therefore map
`updated_at` via `@UpdateDateColumn({ name: 'updated_at' })`, or DB rows updated by raw SQL won't refresh
it. Not a defect in this migration — noting for the entity follow-up.

### 3. Minor — Redundant `DROP INDEX` in `down` (acceptable)
Task 3 drops the three indexes before `DROP TABLE`. `DROP TABLE` already removes its own indexes and FKs,
so these `DROP INDEX IF EXISTS` calls are harmless but redundant (compare `AddBciDevicesTable.down`, which
just drops the table). Fine to keep for explicitness.

## Positive Notes

- `ON DELETE SET NULL` on nullable `session_id` + `ON DELETE CASCADE` on `user_id` precisely encodes the
  "note is the primary entity, survives session deletion" requirement.
- Partial unique index `WHERE "session_id" IS NOT NULL` is exactly the right tool for one-note-per-session
  while permitting multiple detached notes — a non-obvious detail, correctly specified.
- Schema is byte-aligned with ROADMAP Phase 30 and the existing `proto/meditation_notes.proto` field set.
- Named PK/FK/index constraints follow established project style; `timestamptz` matches `bci_devices`.
- Task 4 gives concrete verification (`\d meditation_notes`, index presence, rollback round-trip).
- Honors the CLI-generated-timestamp rule.

## Verdict

Solid, low-risk, codebase-accurate migration plan. The remaining findings are optional polish with no SQL
change required. Proceed to implementation.

PLAN_REVIEW_PASS
