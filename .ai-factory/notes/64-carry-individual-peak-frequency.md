# Carry `individual_peak_frequency` through proto + entity + migration + mapping

**Date:** 2026-06-23
**Source:** conversation context

## Key Findings

- **Already implemented and committed** in commit `9a294ab` ("Carry `individual_peak_frequency` through proto + entity + migration + mapping"). This note documents the shipped state for traceability — there is no remaining API work.
- The NFB calibration record persisted every calibration float **except** the individual peak frequency, which the neiry SDK needs to faithfully re-import a calibration.
- Mobile consumes this contract separately (its proto copy is stale) — see mind_mobile Phase 54 / note `151-mobile-carry-individual-peak-frequency.md`.

## Details

What `9a294ab` changed in `src/nfb-calibration/`:

- **proto** (`proto/nfb_calibration.proto`) — added `float individual_peak_frequency = 12` to `RecordNfbCalibrationRequest` and `float individual_peak_frequency = 14` to `NfbCalibrationRecord` (appended at the end to preserve existing field numbers).
- **entity** (`entities/nfb-calibration-record.entity.ts`) — added a `nullable` `double precision` column `individual_peak_frequency` (`individualPeakFrequency: number | null`). Nullable so rows written before the field existed remain valid.
- **migration** (`migrations/1780250925581-AddIndividualPeakFrequencyToNfbCalibration.ts`) — `ALTER TABLE "nfb_calibration_records" ADD COLUMN "individual_peak_frequency" double precision` (drop on `down`).
- **service** (`nfb-calibration.service.ts`) — `record()` maps `individualPeakFrequency: req.individualPeakFrequency` into the entity.
- **mapper** (`grpc/grpc-mappers.ts`, `toProtoNfbCalibrationRecord`) — emits `entity.individualPeakFrequency ?? 0`, so a null (legacy row) returns `0` on the wire. The `<=0` value is the sentinel the mobile read-back uses to fall back to `individualFrequency`.

## Open Questions

- None. The skip-recalibration import round-trip that would *consume* this field lives entirely on the mobile/SDK side and is still unwired (separate concern, tracked on the mobile roadmap).
