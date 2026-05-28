# Review: 20-migration-addnfbcalibrationrecordstable

**Scope:** `src/migrations/1779993063433-AddNfbCalibrationRecordsTable.ts` (new)

Other files in this diff are plan/plan-review artifacts under `.ai-factory/` and carry no runtime risk; only the migration source was reviewed for correctness.

## Findings

None.

### Sanity checks performed

1. **Migration ordering & class name.** Timestamp `1779993063433` is strictly greater than every existing migration (latest existing: `1779990145496-AddBioSessionSamplesTable`), so it will execute last on `migrationsRun: true` startup. Class name `AddNfbCalibrationRecordsTable1779993063433` matches the filename — TypeORM's discovery would otherwise misregister the migration.

2. **`uuid_generate_v4()` available.** The `uuid-ossp` extension is enabled in `InitialSchema` and is already reused by `AddBciDevicesTable.ts` without re-enabling. The default expression here will resolve at insert time.

3. **FK target exists.** `users("id")` is created in `InitialSchema` and referenced by the prior `bci_devices` FK with the same `ON DELETE CASCADE` semantics. Cascade direction is correct — deleting a user purges their calibration history, which is the intended ownership model.

4. **Column types match the roadmap spec.** All 14 columns appear in the specified order with the right nullability:
   - `uuid`, `character varying`, `boolean` for identity/metadata columns.
   - `TIMESTAMP WITH TIME ZONE` for both `calibrated_at` and `created_at` — matches the timestamptz convention used elsewhere in the schema and avoids the naked-timestamp footgun seen in `bio_session_samples`.
   - `double precision` for the seven calibration floats — the conventional PostgreSQL mapping for TypeORM's `float` column type; will not require a schema rewrite when the entity is added in the next milestone.
   - `fail_reason` is correctly nullable (no `NOT NULL`); the `DEFAULT NULL` is redundant but harmless.

5. **Constraints.** PK and FK are named per project convention (`PK_<table>_<col>`, `FK_<table>_<col>`). No unique constraint, matching the "every calibration run is a distinct historical record" requirement.

6. **Index.** `IDX_nfb_calibration_records_user_device (user_id, device_serial)` supports both the user/device list query and the user-only query via left-prefix. Index name length is within PostgreSQL's 63-byte identifier limit (49 bytes).

7. **`down()` is idempotent and ordered correctly.** Drops the index first, then the table, both with `IF EXISTS`. Matches the established pattern in `AddBioSessionSamplesTable.ts`. (Note: `DROP TABLE` would cascade-drop the index anyway, so the explicit `DROP INDEX` is defensive but acceptable.)

8. **No security or rules-file issues.** No `!` operator, no logging, no PII handling, no gRPC parameter shape — `RULES.md` does not apply to this DDL-only change.

9. **No runtime breakage from interaction with other modules.** The new table is not yet referenced by any entity, repository, or service in the current diff — `src/` has no `nfb`/`NfbCalibration` symbols outside the proto stubs from milestone 19. The migration is self-contained and will not affect application startup beyond adding the table.

REVIEW_PASS
