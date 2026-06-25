# Mind API — Roadmap

## Phase 52 — Carry `individual_peak_frequency` through the NFB calibration contract

`NfbCalibrationRecord` persisted every calibration float except the individual peak frequency the neiry SDK needs to faithfully re-import a calibration. Added end-to-end so the value survives the round-trip; mobile consumes the updated proto separately (mind_mobile Phase 54).

- [x] **Carry `individual_peak_frequency` through proto + entity + migration + mapping** — Added `float individual_peak_frequency` to `proto/nfb_calibration.proto` (`RecordNfbCalibrationRequest` field 12, `NfbCalibrationRecord` response field 14 — appended to preserve existing numbers), a nullable `double precision` column on the `NfbCalibrationRecord` entity (`individualPeakFrequency: number | null`, so pre-existing rows stay valid) + migration `1780250925581-AddIndividualPeakFrequencyToNfbCalibration`, `NfbCalibrationService.record` mapping `req.individualPeakFrequency`, and `toProtoNfbCalibrationRecord` emitting `entity.individualPeakFrequency ?? 0` (null→0 sentinel for legacy rows that the mobile read-back falls back from). Shipped in commit `9a294ab`. Spec: `.ai-factory/notes/64-carry-individual-peak-frequency.md`.

## Phase 53 — Generalize meditation notes to ModuleSessionNote

`meditation_notes` was scoped to meditation but structurally already generic — `session_id` links to `module_sessions` which carries `activityType` and `activityRefId`. The only meditation-specific artefacts are the name and `pose_id` (which duplicates `module_sessions.activityRefId`). This phase renames everything to `ModuleSessionNote` and removes `pose_id`, making post-session notes available to any activity type.

- [ ] **Rename proto + API backend to ModuleSessionNote** — `meditation_notes.proto` has `MeditationNotesService` / `MeditationNote` with a redundant `pose_id` (field 3) that duplicates `module_sessions.activityRefId`; rename proto file to `module_session_notes.proto`, rename service to `ModuleSessionNotesService`, drop `pose_id` from `CreateNoteRequest` (keep field 4 `note_text` at its existing number), rename `src/meditation-notes/` module to `src/module-session-notes/` (entity, service, controller, module), migration `RenameToModuleSessionNotes` (`ALTER TABLE meditation_notes RENAME TO module_session_notes` + `DROP COLUMN pose_id`), update `toProtoMeditationNote` mapper → `toProtoModuleSessionNote`, update `AppModule` import. Spec: `.ai-factory/notes/01-module-session-note-proto-and-api.md`.

---STOP---
