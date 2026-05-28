# Code Review: NfbCalibrationRecord entity + NfbCalibrationModule skeleton

**Plan:** `21-nfbcalibrationrecord-entity-nfbcalibrationmodule-skeleton.md`
**Branch:** `dev`
**Scope reviewed:** all staged changes under `src/` (`app.module.ts`, `src/nfb-calibration/**`). Plan/plan-review markdown excluded.

## Verification performed

- `npx tsc --noEmit` — clean (no errors).
- Read every new/modified `.ts` file in full.
- Cross-checked entity columns against `src/migrations/1779993063433-AddNfbCalibrationRecordsTable.ts` row by row.
- Cross-checked module shape against `src/bci/bci.module.ts` (the reference pattern named in the plan).
- Cross-checked `app.module.ts` insertion site against `BciModule` placement.

## Findings

### 1. `type: 'float'` in entity does not match `double precision` in migration — latent migration-generation hazard

**Severity:** 🟡 Minor — does not break runtime in this milestone, but it is wrong and the plan-review already flagged this. The implementer followed the plan literally instead of correcting it.

`src/nfb-calibration/entities/nfb-calibration-record.entity.ts:30-50` declares all seven numeric columns as `@Column({ ..., type: 'float' })`. TypeORM's Postgres driver maps the abstract `'float'` type to `real` (single-precision `float4`), whereas `1779993063433-AddNfbCalibrationRecordsTable.ts:15-21` created the table with `double precision` (`float8`) for those seven columns.

Runtime impact in this milestone:
- `synchronize: false`, so boot will not attempt to alter the schema — no immediate failure.
- Reads/writes work — `node-postgres` decodes both `real` and `double precision` as JS `number`.

Latent impact:
- The next time anyone runs `npm run migration:generate` against this entity, TypeORM will diff `real` ≠ `double precision` and emit an `ALTER COLUMN ... TYPE real` migration that silently downgrades precision on all seven calibration fields. That is data-loss-shaped and easy to miss in a generated migration.

**Recommended fix:** change the seven numeric columns to `type: 'double precision'` (or equivalently `'float8'`) so the entity faithfully mirrors the table. The plan-review noted this exact issue as a non-blocking nit; raising it again here because the entity is now committed and will keep producing bogus diffs until corrected.

### 2. Unused `private readonly` constructor parameters in stub classes

**Severity:** ℹ️ Informational — intentional per the plan, not a defect.

`NfbCalibrationService` injects `repo` and `NfbCalibrationGrpcController` injects `service`, neither used. The plan explicitly punts the method bodies to the next two milestones (`NfbCalibrationService` and `NfbCalibrationGrpcController` tasks in Phase 20 of `ROADMAP.md`). `tsconfig` does not flag unused parameter properties, so the build passes. Flagging only so a future reader does not "clean up" what is intentionally a scaffold.

### 3. Reviewed and OK

- **Entity ↔ migration mapping:** all column names, nullability, and the `@Index(['userId', 'deviceSerial'])` (non-unique) match the migration's `IDX_nfb_calibration_records_user_device`. No `@UpdateDateColumn` (append-only — correct).
- **No `!` non-null assertions** anywhere — complies with `RULES.md`.
- **No logging added** — compliant with the "no PII / lean logs" rules vacuously.
- **`NfbCalibrationModule`** mirrors `BciModule` exactly (`AuthModule + TypeOrmModule.forFeature([entity])`, single controller, single provider). `AuthModule` import is correct preparation for the next-milestone controller which will need `@GrpcCurrentUser()` / `GrpcAuthInterceptor`.
- **`AppModule`** registers `NfbCalibrationModule` directly after `BciModule` (`src/app.module.ts:36`), grouped sensibly. Import added at `src/app.module.ts:17`.
- **Empty `@Controller()`** with no `@GrpcMethod` handlers — harmless on a gRPC microservice; no service binding is attempted, no startup warning.
- **Proto / gRPC registration** — intentionally out of scope for this milestone (Phase 20's last bullet covers `main.ts` protoPath). Confirmed not silently missed: `main.ts:60` will be touched in the dedicated milestone.

## Summary

One latent issue worth fixing now (`type: 'float'` → `'double precision'` on seven columns), zero security issues, zero correctness bugs at the boundary of this milestone's scope. Everything else matches the plan and the migration.
