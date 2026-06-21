# Plan Review 2: Biometric LOD aggregated read — on-the-fly aggregation + contract

**Plan:** `75-biometric-lod-aggregated-read-on-the-fly-aggregation-contract.md`
**Files Reviewed:** 4 plan tasks against `sessions.service.ts`, `sessions.controller.ts`, `dto/time-range-query.dto.ts`, `realtime/entities/bio-session-sample.entity.ts`, `changelog.service.ts` (raw-query convention), plus review-1
**Risk Level:** 🔴 High — the must-fix from review-1 is still present in the plan text

## Code Review Summary

This is the second-pass review. The plan body is **unchanged** from the version review-1 examined: Task 2 still enumerates its `FROM`/`WHERE`/`GROUP BY` bullets without the per-session scoping predicate. The single hard blocker identified in review-1 (Critical Issue 1) has **not** been folded into the plan. Everything else review-1 said still holds; the advisory items remain advisory.

### Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`)** — OK. Pure read-path change inside `SessionsService`; no module boundary crossed. Raw SQL via `this.bioSampleRepo.query(...)` matches the established parameterized-`$n` convention in `changelog.service.ts:57-60` (quoted camelCase columns, values passed as params array — never interpolated). Compliant.
- **Rules (`.ai-factory/RULES.md`)** — OK. No non-null assertion, no sensitive-data logging, logging stays "minimal" per plan settings. REST path, so the gRPC `@Payload()` rule is irrelevant. Compliant.
- **Roadmap (`.ai-factory/ROADMAP.md`)** — OK. Directly implements the Phase 48 LOD milestone; scope (no table/migration/cache/write-path) and the synthetic min/max contract match the milestone text and note 58. Linkage explicit.
- No `.ai-factory/skill-context/aif-review/SKILL.md` present — no project-specific overrides to apply.

### Critical Issues

**1. [STILL UNADDRESSED from review-1] The aggregation SQL must filter by `moduleSessionId`.**
Task 2 lists Unnest, numeric-type filter, group key, aggregate, window filter, garbage-timestamp guard, and `GROUP BY` — but **still omits the per-session scoping predicate**. Confirmed against the codebase:
- The raw path scopes every query with `where.moduleSessionId = sessionId` (`sessions.service.ts:145`).
- `assertSessionOwnership` (`sessions.service.ts:106-120`) only validates ownership of `:id`; it does **not** constrain the subsequent aggregation query.
- The entity carries `@Index(['moduleSessionId'])` (`bio-session-sample.entity.ts:10`) precisely so this filter is the primary access path.

Without `WHERE b."moduleSessionId" = $1`, `aggregateBiometrics` runs `jsonb_array_elements` across **every session's rows for every user** — a cross-user data leak and wrong aggregates, and a full-table jsonb unnest that ignores the index. This is a security defect, not a perf nit.

Required plan edit (Task 2): add an explicit bullet — the query's `WHERE` must begin with `b."moduleSessionId" = $1` (parameterized; quoted camelCase column name, since there is no snake-case naming strategy in this project — verified), with `sessionId` passed as the first param and the remaining `$n` placeholders renumbered accordingly. This must be present before implementation. It is the same finding as review-1 Critical Issue 1 and has not been incorporated.

### Issues / Advisories (carried over from review-1, still applicable)

**2. `@Type(() => Number)` import source (Task 1).** `@Type` is from `class-transformer`; the current DTO (`time-range-query.dto.ts:1`) imports only from `class-validator`. The plan should call out adding the `class-transformer` import. Coercion is safe because `main.ts` sets `transform: true` on the global `ValidationPipe`, so `@IsInt()`/`@Min(1)` reject `abc`→NaN, `0`, negatives, and fractionals.

**3. Convert the `bucket` column too (Task 3).** `floor(...)` comes back from `pg` as a **string**, like `min`/`max`. `bucketStart = bucket * bucketSec * 1000` relies on JS string→number coercion. Explicitly `Number(row.bucket)` before arithmetic (values stay well under `2^53`).

**4. Unconditional `(elem->>'timestamp')::numeric` cast is less tolerant than the raw path (Task 2).** The raw path defensively skips non-`number` timestamps (`sessions.service.ts:179-186`, a guard added after the Phase 32 Long `{low,high}` incident). A single non-scalar/non-numeric timestamp raises a SQL cast error and fails the **whole** request. Note 58 verified the live dataset is clean, so low probability — optionally gate with `jsonb_typeof(elem->'timestamp') = 'number'` in the `WHERE`.

**5. `jsonb_each(elem->'data')` assumes `data` is a non-null object (Task 2).** If any sample's `data` is JSON `null` or a scalar, `jsonb_each` errors and fails the request. `data` is typed `unknown` and persisted verbatim. Low risk per note 58; optional `jsonb_typeof(elem->'data') = 'object'` guard mirrors the raw path's defensiveness.

**6. No coarseness floor on `bucketSec` (Task 2/4).** Unnest cost is independent of `bucketSec` — `@Min(1)` permits the heaviest grouping over the same ~2.3M leaves. Task 4 measures exactly this worst case, which is correct; flag only if the measurement comes back hot.

### Positive Notes

- Reuses the `ModuleSession` already returned by `assertSessionOwnership` for the garbage-timestamp guard rather than issuing a second query.
- Backward-compat branch (`bucketSec === undefined` ⇒ existing raw path byte-for-byte, 413 guard intact) is explicit and preserves the current contract.
- Parameterized-`$n` raw SQL via `bioSampleRepo.query(...)` follows the codebase convention and avoids interpolation.
- Two-synthetic-samples-per-bucket reshape with distinct min/max timestamps matches the web envelope contract from note 58 and avoids degenerate vertical segments.
- Type-driven `jsonb_typeof='number'` keeps `data` opaque and auto-picks-up new producer fields.

### Verdict

**Not ready.** The plan is unchanged since review-1 and still omits the mandatory `moduleSessionId` scoping predicate in Task 2 (Critical Issue 1) — a cross-session data leak and incorrect aggregation. This is a hard blocker. Add the explicit `WHERE b."moduleSessionId" = $1` bullet (and renumber the parameter placeholders) before implementation; fold in advisories 2–6. Re-review after the predicate is added.
