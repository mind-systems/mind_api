# Plan Review 3: Biometric LOD aggregated read — on-the-fly aggregation + contract

**Plan:** `75-biometric-lod-aggregated-read-on-the-fly-aggregation-contract.md`
**Files Reviewed:** 4 plan tasks against `src/sessions/sessions.service.ts`, `src/sessions/sessions.controller.ts`, `src/sessions/dto/time-range-query.dto.ts`, `src/realtime/entities/bio-session-sample.entity.ts`, `src/changelog/changelog.service.ts` (raw-query convention), plus review-1 and review-2.
**Risk Level:** 🟢 Low — the prior hard blocker and every advisory are now folded into the plan text.

## Code Review Summary

Third-pass review. Unlike review-2 (where the plan body was unchanged and the blocker persisted), this revision has **incorporated all prior feedback**. Each item below is verified against the live codebase.

### Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`)** — OK. Pure read-path change confined to `SessionsService`; no module boundary crossed, no cross-module internal import. Raw SQL via `this.bioSampleRepo.query(...)` matches the established parameterized-`$n` convention in `changelog.service.ts:57-60` (quoted camelCase columns, values passed as a params array, never interpolated). Compliant.
- **Rules (`.ai-factory/RULES.md`)** — OK. No non-null assertion introduced, no sensitive-data logging, logging stays "minimal" per plan settings. REST path, so the gRPC `@Payload()` rule is irrelevant. Compliant.
- **Roadmap (`.ai-factory/ROADMAP.md`)** — OK. Directly implements the Phase 48 biometric-LOD milestone; scope (no table/migration/cache/write-path) and the synthetic min/max envelope contract match the milestone text and note 58. Linkage explicit.
- No `.ai-factory/skill-context/aif-review/SKILL.md` present — no project-specific overrides to apply.

### Critical Issues

None. The review-1/review-2 blocker is resolved:

**[RESOLVED] Per-session scoping predicate.** Task 2 now opens with an explicit "Session scoping (must-fix — security blocker)" bullet requiring the `WHERE` clause to **begin with** `b."moduleSessionId" = $1` (parameterized, `sessionId` as the first param, remaining `$n` renumbered). This matches the raw path's `where.moduleSessionId = sessionId` (`sessions.service.ts:145`) and the `@Index(['moduleSessionId'])` on the entity (`bio-session-sample.entity.ts:10`). The note that `assertSessionOwnership` validates ownership of `:id` but does **not** constrain the aggregation query is accurate (`sessions.service.ts:106-120`). The quoted camelCase column name is correct — confirmed no snake-case naming strategy in this project. Blocker cleared.

### Verification of folded-in advisories

- **`@Type` import source (Task 1)** — RESOLVED. Task 1 explicitly states `@Type` comes from `class-transformer` while the current DTO imports only from `class-validator` (confirmed: `time-range-query.dto.ts:1`), and notes `transform: true` on the global `ValidationPipe` makes coercion run before `@IsInt()`/`@Min(1)`. Correct.
- **Convert the `bucket` column too (Task 3)** — RESOLVED. Task 3 now calls out `Number(row.bucket)` alongside `Number(row.min)`/`Number(row.max)`, with the latent-coercion-bug rationale and the `< 2^53` note. Correct.
- **Timestamp cast robustness (Task 2)** — RESOLVED. Task 2 adds `jsonb_typeof(elem->'timestamp') = 'number'` to the predicate, referencing the raw path's defensive skip (`sessions.service.ts:179-186`) and the Phase 32 Long `{low,high}` incident. Correct.
- **`jsonb_each` over non-object `data` (Task 2)** — RESOLVED. Task 2 adds `jsonb_typeof(elem->'data') = 'object'` before unnesting, mirroring raw-path defensiveness. Correct.
- **No coarseness floor on `bucketSec` (Task 4)** — ADDRESSED. Task 4 explicitly notes unnest cost is independent of `bucketSec`, that `@Min(1)` permits the heaviest grouping over the same leaves, and makes the 389k-motion worst-case the measurement target. Correct framing.

### Additional checks (this pass)

- **Controller wiring (Task 1).** `SessionsController.listBiometrics` currently passes 4 args (`user.sub, id, query.from, query.to` — `sessions.controller.ts:43-48`). Task 1's "pass `query.bucketSec` as a 5th argument" is accurate, and the instruction to leave the `instructions` handler untouched is correct (it shares the DTO but must not branch). Good.
- **Service signature change (Task 3).** Current `listBiometrics(userId, sessionId, from?, to?)` (`sessions.service.ts:131-136`) → adding trailing `bucketSec?: number` is back-compatible and the `=== undefined` branch preserves the byte-for-byte raw path including the 413 guard. Good.
- **Reused constants.** `FLUSHED_AT_PAD_MS` is module-level (`sessions.service.ts:29`) and reusable from `aggregateBiometrics`; the new `GARBAGE_TS_SLACK_MS` constant is a clean local addition. `ROW_CAP`/`FLAT_CAP` correctly excluded from the aggregated path. Good.
- **`(kv.value #>> '{}')::numeric` cast.** Correct — `jsonb` number → text via `#>> '{}'` → `numeric` is the valid path (direct `jsonb::numeric` is not). Paired with the `jsonb_typeof(kv.value) = 'number'` filter so only numeric leaves reach the cast. Good.

### Positive Notes

- Reuses the `ModuleSession` already returned by `assertSessionOwnership` for the garbage-timestamp guard (`session.startedAt.getTime()`) instead of a second query — clean.
- Backward-compat branch is explicit and preserves the existing contract and 413 guard.
- Parameterized-`$n` raw SQL via `bioSampleRepo.query(...)` follows the codebase convention and avoids interpolation.
- Two-synthetic-samples-per-bucket reshape with distinct, ordered min/max timestamps (`bucketStart`, `bucketStart + bucketSec*500`) matches the web envelope contract and avoids degenerate vertical segments.
- Type-driven `jsonb_typeof='number'` keeps `data` opaque and auto-picks-up new producer fields — no contract leak.
- Heavy unnest stays in Postgres; only the small aggregated rowset returns to Node — correctly justifies dropping the output-size caps on this path.

### Verdict

Ready to implement. The mandatory `moduleSessionId` scoping predicate is now present in Task 2, and advisories 2–6 from the prior reviews are all folded in. No remaining blockers; the plan is internally consistent and accurate against the codebase.

PLAN_REVIEW_PASS
