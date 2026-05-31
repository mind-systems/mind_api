---
name: NFB calibration — add individual_peak_frequency to proto + storage
description: nfb_calibration.proto and the NfbCalibration entity are missing the bare individual_peak_frequency field; mobile needs it to round-trip calibration without corrupting the peak
type: project
---

# Requirements — add `individual_peak_frequency` to NFB calibration (proto + entity + migration)

**Date:** 2026-05-31
**Source:** cross-project requirement from mind_mobile (calibration round-trip bug). Mobile-side fix: mind_mobile note 53.
**Status:** requirements only — mind_api owns the proto/entity/server; mind_mobile is blocked on this for durable calibration restore.
**Verified (mind_api side, 2026-05-31):** native header confirms the two fields are distinct (`CNFBCalibrator.h:37` `individualFrequency`, `:41` `individualPeakFrequency` — separate members, same 10.0 default). `NfbCalibrationRepository.refreshFromServer` (mind_mobile) does a full `_prefs.setString` replace of the local history with server data → the locally-captured peak is indeed overwritten on the next refresh. Field numbers below confirmed against `proto/nfb_calibration.proto` (14 / 12 are the next free). This requirement **supersedes mind_mobile note 44 Q2's "no mind_api change" conclusion** — note 44 did not account for the cache-replacing refresh. Tracked as mind_api ROADMAP Phase 29.

## Why

neiry's `IndividualNfbData` carries TWO distinct fields: `individualFrequency` AND `individualPeakFrequency` — separate C-struct members (`CNFBCalibrator.h:37,41`) that can hold different values (confirmed in mind_mobile note 44 Q2). The current `nfb_calibration.proto` and the server entity carry `individual_frequency` but NOT the bare `individual_peak_frequency` — only `individual_peak_frequency_power` and `individual_peak_frequency_suppression`, which are different physical quantities.

Consequence on mobile: calibration is stored/restored without the peak; on every reconnect-restore the peak is reconstructed from `individualFrequency`, corrupting it. Mobile can fix the **local cache + live SDK round-trip** on its own (note 53), BUT mobile's `NfbCalibrationRepository.refreshFromServer` REPLACES the local cache with server data — so without a server-side field, the locally-captured peak is **overwritten (lost)** on the next BCI-screen open. The fix is therefore incomplete until the server carries the field.

## Required changes (mind_api)

1. **`proto/nfb_calibration.proto`** — add a `float individual_peak_frequency` field to BOTH messages (append, do NOT renumber existing fields):
   - `NfbCalibrationRecord` → field number **14** (1–13 are in use; 13 = `created_at`).
   - `RecordNfbCalibrationRequest` → field number **12** (1–11 are in use).
2. **`NfbCalibration` entity / DB** — add an `individual_peak_frequency` (float/real) column + migration. Nullable or default-0 is fine; mobile sends a real value once the field exists.
3. **gRPC controller / service mapping** — read `individual_peak_frequency` from `RecordNfbCalibrationRequest` on write (persist it), and populate it on `NfbCalibrationRecord` in `List`. Mirror exactly how `individual_frequency` is already wired.

## After it lands (mind_mobile side — context, not your work)

Per the monorepo proto-ownership rule, the change order is: `mind_api/proto/` → implement in mind_api → mind_mobile copies the updated proto + regenerates stubs → mind_mobile maps the new field in `NfbCalibrationGrpcApi.record()` (send) and `_recordToDomain()` (read). Tracked in mind_mobile note 53.

## Constraints
- `mind_api/proto/` is the single source of truth — this change MUST originate here (mobile must not edit `.proto`).
- Backward-compat: existing records have no peak; default/null is acceptable — mobile already defaults `individualPeakFrequency` from `individualFrequency` when the key is absent.
