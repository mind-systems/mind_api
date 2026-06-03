# Plan Review: Rename `pose_name` → `pose_id` in `meditation_notes`

**Plan:** `.ai-factory/plans/55-rename-pose-name-pose-id-in-meditation-notes.md`
**Risk Level:** 🟢 Low

## Verdict
The plan is accurate and complete. Every file path, field name, and proto field number was verified against the live codebase. All six in-repo references to `poseName` / `pose_name` are accounted for. No blocking issues.

## Reference verification

| Plan claim | Verified | Notes |
|---|---|---|
| Entity `src/meditation-notes/entities/meditation-note.entity.ts` has `@Column({ name: 'pose_name' }) poseName: string` | ✅ line 20-21 | exact match |
| Service `create()` has `poseName` param + shorthand in `this.repo.create({...})` | ✅ lines 18, 21 | both covered by Task 4 |
| Controller passes `req.poseName` in `createNote` | ✅ line 40 | Task 5 |
| Mapper `toProtoMeditationNote` returns `poseName: entity.poseName` | ✅ `src/grpc/grpc-mappers.ts:185` | Task 6 |
| Proto `pose_name = 3` in `MeditationNote`, `pose_name = 2` in `CreateNoteRequest` | ✅ proto lines 18, 31 | field numbers correct, wire-safe to keep |
| Proto comment at line 36 mentions `pose_name` | ✅ | Task 3 notes comment updates |
| `npm run proto:gen` exists and regenerates `proto/generated/` | ✅ package.json:27 | globs `./proto/*.proto` |
| Migration via `npx typeorm migration:create` | ✅ | matches project convention (CLAUDE.md / MEMORY rule) |
| Table empty / no data migration; `varchar` type retained | plausible | consistent with ROADMAP line 179; cannot inspect live DB |

Plan matches ROADMAP item (line 179) and the existing spec note `.ai-factory/notes/37-meditation-notes-rename-pose-field.md`.

## Context Gates

- **Architecture:** No boundary violation. Entity stays owned by `MeditationNotesModule`; `@InjectRepository` confined. No FK added — consistent with the existing denormalized "opaque snapshot" design (`session_id ON DELETE SET NULL`). `ARCHITECTURE.md` has no proto/consumer section to conflict with. — OK
- **Rules (`RULES.md`):** No non-null assertions introduced. No sensitive-data logging (settings: minimal logging). gRPC `@Payload()` + `@GrpcCurrentUser()` pairing is untouched by this rename. — OK
- **Roadmap:** Directly linked — ROADMAP.md line 179 is exactly this task. — OK

## Advisory Notes (non-blocking — WARN)

1. **Verification criterion vs. historical migration.** The plan's verification says "zero remaining `poseName` / `pose_name` references in `src/`". This will NOT be literally true: the already-applied migration `src/migrations/1780461720539-AddMeditationNotesTable.ts:10` legitimately contains `"pose_name" varchar`. That file represents historical schema state and **must not be edited** (the CREATE TABLE already ran against the DB). Recommend narrowing the verification grep to exclude `src/migrations/` (or to `src/meditation-notes/` + `src/grpc/`), so the implementer doesn't "fix" the historical migration. Confirm the plan does NOT touch that file — it correctly doesn't list it, this is only about the verification wording.

2. **Cross-project proto propagation.** Per the monorepo CLAUDE.md proto-ownership rule, any change to `proto/meditation_notes.proto` requires consumers (`mind_mcp`, `mind_mobile`) to copy the updated `.proto` and regenerate stubs. That work is correctly out of scope for this `mind_api` plan, but the rename is a contract change — a follow-up coordination task should exist so mobile actually sends `pose_id`. Worth a one-line mention in the commit body or a roadmap follow-up.

3. **Stale proto comment semantics (minor).** The field comment `// opaque client string, no FK, any value accepted` (proto line 18) describes the old slug semantics. After the rename the value is a pose UUID. The plan already says "update the comment lines that mention `pose_name`"; consider also refreshing this wording so the contract doc isn't misleading. Cosmetic only.

## Positive Notes
- Correctly keeps proto field numbers (3 and 2) — wire-compatible rename, no breaking renumber.
- Correctly forbids hand-editing the generated stub and routes through `proto:gen`.
- Single atomic commit is the right call: a partial rename (entity renamed but DB column not, or proto not regenerated) would break compilation/runtime.
- Migration `up()`/`down()` are symmetric and correct PostgreSQL syntax.
- Dependency ordering between tasks is sound (migration → entity → proto → service/controller/mapper).

PLAN_REVIEW_PASS
