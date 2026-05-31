# Plan Review: Carry `individual_peak_frequency` through proto + entity + migration + mapping

**Plan:** `40-carry-individual-peak-frequency-through-proto-entity-migration-mapping.md`
**Risk Level:** 🟢 Low

## Verification Against Codebase

Every claim in the plan was checked against the actual source files. All hold:

- **Proto field numbers (Task 1)** — `proto/nfb_calibration.proto` confirms `NfbCalibrationRecord` max field is `13 = created_at`; `RecordNfbCalibrationRequest` max field is `11 = upper_frequency`. The chosen numbers `14` and `12` are the correct next-free values and require no renumbering. `individual_frequency` is `float`, so `float` for the new field matches. ✅
- **Stub regeneration (Task 2)** — `package.json` defines `proto:gen` exactly as referenced; `proto/generated/` is committed. The new field does not yet exist in `proto/generated/nfb_calibration.ts`, confirming regeneration is needed. ✅
- **Entity column (Task 3)** — `nfb-calibration-record.entity.ts` confirms `individualFrequency` uses `@Column({ name: 'individual_frequency', type: 'double precision' })`. Mirroring with `nullable: true` and property type `number | null` is correct and consistent with the existing nullable `failReason: string | null` pattern. ✅
- **Migration (Task 4)** — Reference migration `1779993063433-AddNfbCalibrationRecordsTable.ts` confirms table name `nfb_calibration_records` and SQL style. CLI scaffolding via `migration:create` is the project rule. `migrationsRun: true` means it applies on startup, and the manual `migration:run` check is correct. Nullable `ADD COLUMN` (no `NOT NULL`, no default) is the right backward-compat choice. ✅
- **Service write (Task 5)** — `nfb-calibration.service.ts` `record()` builds the entity via `this.repo.create({...})` with straight pass-through fields. Adding `individualPeakFrequency: req.individualPeakFrequency` alongside the siblings is exactly right. ✅
- **Response mapper (Task 6)** — `grpc-mappers.ts` `toProtoNfbCalibrationRecord` exists and uses the `?? ''` coalescing pattern for `failReason`. `entity.individualPeakFrequency ?? 0` is consistent and correctly handles legacy `null` rows. ✅
- **Project rule (no `!`)** — The plan uses `?? 0` rather than a non-null assertion, complying with the stated rule. ✅

## Context Gates

- **Architecture** — No `.ai-factory/ARCHITECTURE.md` boundary concern. Change is confined to the `NfbCalibration` feature module plus the shared proto contract and shared `grpc-mappers.ts`, consistent with the modular-monolith conventions in `mind_api/CLAUDE.md`. The proto-ownership rule (`mind_api/proto/` is source of truth) is respected — the change starts in proto. **WARN (informational):** Per the cross-project proto rule, `mind_mcp` and `mind_mobile` must later copy the updated `.proto` and regenerate stubs; that is out of this milestone's scope but should be tracked downstream.
- **Rules** — Migration rule (CLI-only, never hand-craft timestamps) is honored. No non-null assertion. ✅
- **Roadmap** — Milestone-scoped `feat` work; linkage is implicit via the numbered plan sequence. No blocking issue.

## Minor Notes (Non-Blocking)

1. **Task 6 reasoning is slightly inaccurate about the REST path.** The plan states the REST controller "delegate[s] to the service and this mapper." In fact `nfb-calibration.rest.controller.ts` returns raw entities (`return { records, total }`) and does **not** pass through `toProtoNfbCalibrationRecord`. The *conclusion* still holds — once the entity gains the column, the REST response automatically includes `individualPeakFrequency` with no code change. The only behavioral consequence: legacy rows surface as `null` over REST (not coalesced to `0` like the gRPC path). Given mobile consumes the field via gRPC and defaults from `individualFrequency` when absent, this is acceptable, but the plan's stated rationale should not be relied on — the REST field is carried by the entity serialization, not the mapper. No action required unless REST consumers must also see `0` instead of `null`.

2. **No test coverage** is planned (Settings: Testing = no). Consistent with the milestone's stated scope and the mechanical, mirror-an-existing-field nature of the change. Acceptable.

## Positive Notes

- Field-by-field mirroring of `individual_frequency` keeps the change minimal and low-risk.
- Correct, explicit handling of the backward-compat edge: nullable column + null-coalescing mapper, with the reasoning spelled out.
- Explicit guardrails against common mistakes: no proto renumbering, CLI-generated migration timestamp, no hand-editing generated stubs, no touching the unrelated `_power` / `_suppression` fields, no non-null assertion.
- Sensible commit grouping aligned to the three phases.

PLAN_REVIEW_PASS
