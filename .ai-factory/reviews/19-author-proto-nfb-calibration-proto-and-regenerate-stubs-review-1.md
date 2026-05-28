# Review: Author `proto/nfb_calibration.proto` and regenerate stubs

## Scope
- New file: `proto/nfb_calibration.proto` (69 lines).
- Regenerated stub: `proto/generated/nfb_calibration.ts` (gitignored — not tracked, consistent with sibling generated files).

## Verification against milestone spec

### `NfbCalibrationRecord` (13 fields)
- `id=1`, `device_serial=2`, `calibrated_at=3`, `is_valid=4`, `fail_reason=5`, `individual_frequency=6`, `individual_peak_frequency_power=7`, `individual_peak_frequency_suppression=8`, `individual_bandwidth=9`, `individual_normalized_power=10`, `lower_frequency=11`, `upper_frequency=12`, `created_at=13`. All 13 fields present, correct types (string/bool/float), sequential field numbers. ✓
- Timestamps are `string` (ISO-8601), matching the `BciDevice` / `SyncEventDto` convention. ✓
- `fail_reason` is a plain `string` with documented null↔empty mapping (proto3 default). Consistent with later service-layer mapping rule (`req.failReason || null`, `entity.failReason ?? ''`). ✓

### `RecordNfbCalibrationRequest` (11 fields)
- Numeric/value fields match the entity minus `id` and `created_at`. Field numbers 1–11, correct order. ✓
- No `user_id` — auth via interceptor. Comment matches `bci_devices.proto` convention. ✓

### `ListNfbCalibrationsRequest`
- `string device_serial = 1; int32 limit = 2;` — exact match. `limit=0` semantics documented. ✓

### `ListNfbCalibrationsResponse`
- `repeated NfbCalibrationRecord records = 1;` ✓

### `NfbCalibrationService`
- `rpc Record(RecordNfbCalibrationRequest) returns (NfbCalibrationRecord);`
- `rpc List(ListNfbCalibrationsRequest) returns (ListNfbCalibrationsResponse);`
- Both unary, no streams. ✓

## Generated stub check
`proto/generated/nfb_calibration.ts` exists and exports:
- `NfbCalibrationRecord`, `RecordNfbCalibrationRequest`, `ListNfbCalibrationsRequest`, `ListNfbCalibrationsResponse` interfaces with camel-cased fields and correct primitive types.
- `NfbCalibrationServiceController` interface for the `@Controller` side.
- `NfbCalibrationServiceControllerMethods()` decorator that registers `Record` and `List` via `GrpcMethod("NfbCalibrationService", method)`.
- `NFB_CALIBRATION_SERVICE_NAME = "NfbCalibrationService"`.
- `path: "/mind.NfbCalibrationService/Record"` and `/mind.NfbCalibrationService/List` for the static service descriptor.

These are exactly what later milestones (controller / `main.ts` registration) will consume — no missing surface.

## Other observations
- No `google.protobuf.Empty` import — correct, neither RPC uses it.
- Header comment "Maps to NfbCalibration entity in src/nfb-calibration/." refers to a path that does not exist yet; it will exist in later milestones. Non-blocking — same pattern as `bci_devices.proto` which references `src/bci/entities/bci-device.entity.ts`.
- `.gitignore` has `/proto/generated` — only the `.proto` file is staged. Consistent with prior phases (`bci_devices.proto`, `module_biometric_stream.proto`).
- No security, race-condition, or runtime concerns — proto-only milestone, no executable code added.

REVIEW_PASS
