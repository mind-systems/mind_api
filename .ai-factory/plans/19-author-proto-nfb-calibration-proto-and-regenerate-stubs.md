# Plan: Author `proto/nfb_calibration.proto` and regenerate stubs

## Context
Add the proto contract for the NFB calibration history feature so backend and mobile can share types. This milestone only authors the `.proto` file and regenerates the TypeScript stubs in `proto/generated/`; no service, controller, migration, or entity work is included (those are separate milestones).

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Author the proto contract

- [x] **Task 1: Create `proto/nfb_calibration.proto`**
  Files: `proto/nfb_calibration.proto`
  Author a new proto file modelled on `proto/bci_devices.proto` (same `syntax = "proto3";`, `package mind;`, header comment style, and JWT-from-interceptor convention — no `user_id` in request messages).

  Required content:

  - `syntax = "proto3";` and `package mind;` at the top. No `google.protobuf.Empty` import is needed (no Empty responses).
  - Section header comment "Shared types" (match the style used in `bci_devices.proto`).
  - Message `NfbCalibrationRecord` with exactly 13 fields, field numbers 1–13 in this order:
    1. `string id = 1;`
    2. `string device_serial = 2;`
    3. `string calibrated_at = 3;` — ISO-8601 string (comment matching the `created_at` convention used in `BciDevice`)
    4. `bool is_valid = 4;`
    5. `string fail_reason = 5;` — `"none" | "tooManyArtifacts" | "peakFrequencyAtBorder"` (use proto3 default empty string when null on the server side; document this in a comment)
    6. `float individual_frequency = 6;`
    7. `float individual_peak_frequency_power = 7;`
    8. `float individual_peak_frequency_suppression = 8;`
    9. `float individual_bandwidth = 9;`
    10. `float individual_normalized_power = 10;`
    11. `float lower_frequency = 11;`
    12. `float upper_frequency = 12;`
    13. `string created_at = 13;` — ISO-8601, server-assigned (mirror the comment from `BciDevice.created_at`)
  - Section header comment "Per-RPC request / response messages".
  - Message `RecordNfbCalibrationRequest` — same numeric fields as `NfbCalibrationRecord` minus `id` and `created_at`, plus `device_serial`, `calibrated_at`, `is_valid`, `fail_reason`. Field numbers 1–11 in this order:
    1. `string device_serial = 1;`
    2. `string calibrated_at = 2;`
    3. `bool is_valid = 3;`
    4. `string fail_reason = 4;`
    5. `float individual_frequency = 5;`
    6. `float individual_peak_frequency_power = 6;`
    7. `float individual_peak_frequency_suppression = 7;`
    8. `float individual_bandwidth = 8;`
    9. `float individual_normalized_power = 9;`
    10. `float lower_frequency = 10;`
    11. `float upper_frequency = 11;`
    Add comment "auth identity comes from metadata/interceptor, not the message" (matching the `bci_devices.proto` convention).
  - Message `ListNfbCalibrationsRequest`:
    - `string device_serial = 1;`
    - `int32 limit = 2;` — comment: `0 = server default (50)`.
    Same auth comment as above.
  - Message `ListNfbCalibrationsResponse`:
    - `repeated NfbCalibrationRecord records = 1;`
  - Section header comment "Service definition" describing each RPC (mirror `bci_devices.proto`):
    - `Record` — unary RPC that appends a new calibration record for the authenticated user and returns the saved `NfbCalibrationRecord`.
    - `List` — unary RPC returning the authenticated user's recent calibration records for the given device serial, ordered newest-first.
  - Service block:
    ```
    service NfbCalibrationService {
      rpc Record(RecordNfbCalibrationRequest) returns (NfbCalibrationRecord);
      rpc List(ListNfbCalibrationsRequest) returns (ListNfbCalibrationsResponse);
    }
    ```

  Constraints:
  - No `user_id` anywhere in request messages — identity is read from the JWT interceptor (same pattern as `BciDevicesService`).
  - All timestamp fields are `string` (ISO-8601), never `google.protobuf.Timestamp` — matches the project convention used in `SyncEventDto` and `BciDevice`.
  - Do not add any extra fields beyond those listed above.

### Phase 2: Regenerate stubs

- [x] **Task 2: Regenerate TypeScript stubs** (depends on Task 1)
  Files: `proto/generated/nfb_calibration.ts` (new — created by the generator)
  Run `npm run proto:gen` from `mind_api/`. This invokes `protoc` with `ts-proto` (`nestJs=true, outputServices=grpc-js, esModuleInterop=true`) and regenerates stubs for every `*.proto` file into `proto/generated/`.

  Verify after the run:
  - `proto/generated/nfb_calibration.ts` exists and exports the four messages (`NfbCalibrationRecord`, `RecordNfbCalibrationRequest`, `ListNfbCalibrationsRequest`, `ListNfbCalibrationsResponse`) and the `NfbCalibrationService` controller decorator constants used by `@GrpcMethod`.
  - The other generated files (`bci_devices.ts`, `sync.ts`, …) are still present and not corrupted (the generator regenerates all of them — this is expected; commit any incidental whitespace/import-order changes alongside the new file so the working tree is clean).
  - Do not hand-edit anything inside `proto/generated/`.

<!-- orchestrator-sessions
planner: a661e8e1-e6a2-444c-8a71-8a140fef7f12
elapsed: 368
implementer: de1d0e4f-15db-46eb-82b3-27adf9ab01fc
-->
