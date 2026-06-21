# Plan Review: Biometric LOD aggregated read — on-the-fly aggregation + contract

**Plan:** `75-biometric-lod-aggregated-read-on-the-fly-aggregation-contract.md`
**Files Reviewed:** 4 plan tasks against `sessions.service.ts`, `sessions.controller.ts`, `time-range-query.dto.ts`, `bio-session-sample.entity.ts`, `main.ts`, write-path controller, note 58, ROADMAP Phase 48
**Risk Level:** 🟡 Medium

The plan is well-grounded: it matches the stored jsonb shape (`{ timestamp:number, sampleType:string, data:{...} }`, confirmed in `module-biometric-stream.grpc.controller.ts:135-139` and `BioSampleInternal`), correctly reuses the existing `flushedAt`-padding strategy, correctly captures the `ModuleSession` already returned by `assertSessionOwnership` (line 119), and respects the "no table/migration/cache" scope. The `(kv.value #>> '{}')::numeric` detail and the `jsonb_typeof='number'` schema-agnostic filter are accurate. One critical omission and a few advisory items below.

### Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`)** — WARN/none. Pure read-path change inside `SessionsService`; no module boundary crossed, no internal import from another module. The raw SQL via `this.bioSampleRepo.query(...)` is consistent with the established `repository.query`/`manager.query` pattern in `changelog.service.ts:57` and `stats.service.ts:102`. Compliant.
- **Rules (`.ai-factory/RULES.md`)** — none. No non-null assertion introduced, no sensitive-data logging, logging is "minimal" per plan settings. The gRPC `@Payload()` rule is irrelevant (REST path). Compliant.
- **Roadmap (`.ai-factory/ROADMAP.md`)** — OK. Directly implements Phase 48 (`[ ] Biometric LOD aggregated read — on-the-fly aggregation + contract`). Scope, guards, and the (i) synthetic-min/max contract all match the milestone text and note 58. Linkage is explicit.
- No `.ai-factory/skill-context/aif-review/SKILL.md` present — no project-specific review overrides to apply.

### Critical Issues

**1. The aggregation SQL must filter by `moduleSessionId` — Task 2 never states it.**
Task 2 lists the `FROM`/`WHERE` clauses bullet-by-bullet (numeric-type filter, flushedAt window, per-sample bound, garbage-timestamp guard, `GROUP BY`) but **omits the per-session scoping predicate** `WHERE b.moduleSessionId = $sessionId`. The raw path enforces this via `where.moduleSessionId = sessionId` (`sessions.service.ts:145`). Without it the aggregation runs `jsonb_array_elements` across **every session's rows in the table** — a cross-user data leak *and* wrong aggregates. `assertSessionOwnership` validates ownership but does **not** constrain the subsequent query; the SQL itself must scope to the session id. The `@Index(['moduleSessionId'])` on the entity also exists precisely so this filter is the primary access path. Add an explicit bullet: the query's `WHERE` must begin with `b."moduleSessionId" = $1` (parameterized), and pass `sessionId` as the first param. This is the one must-fix before implementation.

### Issues / Advisories

**2. `@Type(() => Number)` import source (Task 1).** `@Type` comes from `class-transformer`, while `@IsOptional/@IsInt/@Min` come from `class-validator`. The current DTO imports only from `class-validator`. The plan should call out adding the `class-transformer` import. Confirmed safe to rely on `@Type`: `main.ts:130` sets `transform: true` on the global `ValidationPipe`, so query-string→number coercion will run and `@IsInt()`/`@Min(1)` will reject `abc` (→ NaN), `0`, negatives, and fractionals as intended. No action beyond the import note.

**3. Convert the `bucket` column too, not just `min`/`max` (Task 3).** Task 3 says to convert the text `min`/`max` returned by node-postgres to `number`, but `floor(... )` (the bucket index) also comes back as a **string** from `pg`. `bucketStart = bucket * bucketSec * 1000` will do string-times-number coercion that mostly works but is fragile; `String * number` for `"123"*1000` yields `123000` in JS, yet relying on that is a latent bug. Explicitly `Number(row.bucket)` before arithmetic. (Values stay within `Number.MAX_SAFE_INTEGER`: epoch-ms ≈ 1.7e12, safely < 2^53.)

**4. Robustness of `(elem->>'timestamp')::numeric` against malformed timestamps (Task 2).** The raw path defensively skips samples where `timestamp` is not a `number` (`sessions.service.ts:180-186`) — a guard added because Phase 32 once stored timestamps as Long `{low,high}` objects. The aggregated path casts unconditionally; a single non-scalar `timestamp` (or non-numeric text) would raise a SQL cast error and fail the **whole** request rather than skipping one sample. Note 58 verified the live 860k-row dataset is clean (all scalar integers), so this is low-probability, but the plan should acknowledge the asymmetry: the aggregated path is less tolerant of malformed timestamps than the raw path. Optional hardening: gate the cast on `jsonb_typeof(elem->'timestamp') = 'number'` in the `WHERE`.

**5. `jsonb_each(elem->'data')` assumes `data` is always a non-null object.** If any sample's `data` is JSON `null` or a scalar, `jsonb_each` errors and fails the request. `BioSampleInternal.data` is typed `unknown` and the write path passes it through verbatim (`data: s.data`) with no shape enforcement at persistence. Note 58 confirms current data is always a flat object, so low risk — but consider `jsonb_typeof(elem->'data') = 'object'` as a cheap guard in the unnest predicate, mirroring the defensiveness the raw path already has.

**6. No upper bound on bucket count / output size (Task 2/3).** The plan deliberately drops `ROW_CAP`/`FLAT_CAP`/413 on the aggregated path (justified: only the small aggregated rowset returns to Node). Correct for output, but note the **unnest cost is independent of `bucketSec`** — `bucketSec=1` over the 389k-motion session unnests the same ~2.3M leaves as a coarse bucket, only the grouping changes. Task 4 measures the worst case, which is the right call; just be aware `@Min(1)` permits the heaviest-grouping request and there is no server-side coarseness floor. Acceptable for this milestone; flag only if Task 4's measurement comes back hot.

### Positive Notes

- Correctly identifies that `assertSessionOwnership` already returns the `ModuleSession` (line 119) and reuses `session.startedAt.getTime()` for the garbage-timestamp guard rather than issuing a second query — clean.
- The backward-compat branch (`bucketSec === undefined` ⇒ existing raw path byte-for-byte, 413 guard intact) is explicit and preserves the existing contract.
- Parameterized-`$n` raw SQL via `bioSampleRepo.query(...)` follows the codebase convention and avoids string interpolation — the SQL-injection guard called out in Task 2 is the right instinct.
- The two-synthetic-samples-per-bucket reshape with distinct min/max timestamps (`bucketStart`, `bucketStart + bucketSec*500`) matches the web contract settled in note 58/web note 32 and avoids the degenerate vertical-segment rendering.
- Type-driven aggregation (`jsonb_typeof='number'`) keeps `data` opaque and picks up new producer fields automatically — no contract leak, consistent with the entity's opaque-jsonb design.

### Verdict

Solid plan with one must-fix: **Task 2 must explicitly scope the aggregation query to `moduleSessionId` in the `WHERE` clause** (Critical Issue 1) — without it the feature leaks cross-session data and returns wrong results. Items 2–6 are advisory hardening the implementer should fold in. Once the session-scoping predicate is added to Task 2, the plan is ready to implement.
