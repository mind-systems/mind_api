# Mind API — Roadmap

## Phase 52 — Carry `individual_peak_frequency` through the NFB calibration contract

`NfbCalibrationRecord` persisted every calibration float except the individual peak frequency the neiry SDK needs to faithfully re-import a calibration. Added end-to-end so the value survives the round-trip; mobile consumes the updated proto separately (mind_mobile Phase 54).

- [x] **Carry `individual_peak_frequency` through proto + entity + migration + mapping** — Added `float individual_peak_frequency` to `proto/nfb_calibration.proto` (`RecordNfbCalibrationRequest` field 12, `NfbCalibrationRecord` response field 14 — appended to preserve existing numbers), a nullable `double precision` column on the `NfbCalibrationRecord` entity (`individualPeakFrequency: number | null`, so pre-existing rows stay valid) + migration `1780250925581-AddIndividualPeakFrequencyToNfbCalibration`, `NfbCalibrationService.record` mapping `req.individualPeakFrequency`, and `toProtoNfbCalibrationRecord` emitting `entity.individualPeakFrequency ?? 0` (null→0 sentinel for legacy rows that the mobile read-back falls back from). Shipped in commit `9a294ab`. Spec: `.ai-factory/notes/64-carry-individual-peak-frequency.md`.

---STOP---
