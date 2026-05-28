# Plan Review: NfbCalibrationRecord entity + NfbCalibrationModule skeleton

**Plan:** `21-nfbcalibrationrecord-entity-nfbcalibrationmodule-skeleton.md`
**Risk Level:** 🟢 Low

## Verification against the codebase

- **Migration cross-check (`1779993063433-AddNfbCalibrationRecordsTable.ts`):** entity columns enumerated in Task 1 line up 1:1 with the table columns — `id uuid`, `user_id uuid`, `device_serial varchar`, `calibrated_at timestamptz`, `is_valid bool`, `fail_reason varchar NULL`, seven `double precision` floats, `created_at timestamptz DEFAULT now()`. Nullability and types match.
- **Index cross-check:** the plan's `@Index(['userId', 'deviceSerial'])` (non-unique) matches the migration's `IDX_nfb_calibration_records_user_device` on `(user_id, device_serial)`.
- **Snake-case mapping:** correct. `database.config.ts` configures no `namingStrategy`, so TypeORM uses property name verbatim as the column name (confirmed by `BioSessionSample` where `moduleSessionId` produced the literal `moduleSessionId` column in its migration). Plan rightly adds explicit `name: 'device_serial'`, `name: 'is_valid'`, etc. — without them, runtime SELECTs would target non-existent camelCase columns.
- **Reference pattern fidelity:** `BciDevice` entity and `BciModule` exactly match what the plan prescribes (no `!`, plain class properties, `AuthModule + TypeOrmModule.forFeature(...)`). `BciDevicesGrpcController`'s constructor injects only the service — consistent with the controller stub the plan describes.
- **AppModule registration (Task 5):** confirmed `BciModule` is on line 34 of `app.module.ts`; placing `NfbCalibrationModule` next to it is sensible and the import statement is the only structural change required.

## Context Gates

- **ARCHITECTURE.md — PASS.** Plan follows the "one directory per feature module" template, keeps the entity inside its owning module, and routes `@InjectRepository` only within `NfbCalibrationModule`. No cross-module repo access, no `synchronize` mutation, no circular imports.
- **RULES.md — PASS.** Plan explicitly forbids the non-null assertion (`!`) on class fields, matching the project's hard rule. No logging is added in this skeleton, so "no sensitive data in logs" / "keep logs lean" are vacuously satisfied. The `@Payload()`-with-`@GrpcCurrentUser()` rule is deferred to the next milestone (the controller has no methods yet), which is fine.
- **ROADMAP.md — PASS.** Plan implements the third bullet of Phase 20 ("`NfbCalibrationRecord` entity + `NfbCalibrationModule` skeleton") and intentionally defers the service/controller bodies to the next two bullets. Scope is correctly bounded.

## Critical Issues

None — no blocking bugs, no missing files, no security exposure, no migration gap.

## Minor Notes (non-blocking)

1. **`type: 'float'` vs. migration's `double precision`.** TypeORM's Postgres driver maps the abstract `'float'` column type to a single-precision `real`, while the migration created `double precision` columns. With `synchronize: false` this does **not** cause a boot failure or data-loss bug — `SELECT`s decode either type as JS `number`. However, if anyone later runs `npm run migration:generate`, TypeORM will diff the column types and propose an `ALTER COLUMN ... TYPE real` migration, which would silently downgrade precision on every numeric calibration field. Recommend `type: 'double precision'` (or `'float8'`) on the seven numeric columns so the entity is a faithful mirror of the table. (This is consistent feedback regardless of the roadmap wording — the roadmap also said `float`, but the migration ultimately used `double precision`.)

2. **Verification statement is slightly optimistic.** "App boot does not throw — TypeORM finds the `nfb_calibration_records` table … and matches it to the entity columns." With `synchronize: false` and no startup schema check, TypeORM does **not** validate column-by-column matching at boot — it would boot successfully even with a column-name typo. Real validation only happens on the first SELECT/INSERT against a misnamed column at runtime (i.e., in the next milestone). Worth tightening the wording so the implementer knows compile + boot is not proof the mapping is right.

3. **Empty controller registration.** A `@Controller()` with no `@GrpcMethod`-decorated members is harmless on a NestJS gRPC microservice — no service registration is attempted, no startup warning. Worth noting for the implementer in case they expect the gRPC layer to complain.

## Positive Notes

- Plan correctly anticipates the snake-case naming-strategy gotcha and writes it down — this is the exact mistake the `bio_session_samples` migration immortalized.
- Phasing (entity → service stub → controller stub → module → AppModule) gives clean per-task dependencies and matches the BCI feature's commit shape.
- Scope discipline is good: stubs are scaffolds only, with method bodies explicitly punted to the next milestones referenced by name. This avoids overlap with `aif-implement`'s next runs.
- Anchoring to the `BciModule`/`BciDevice` reference pattern keeps style consistent with the most recent similar feature.

PLAN_REVIEW_PASS
