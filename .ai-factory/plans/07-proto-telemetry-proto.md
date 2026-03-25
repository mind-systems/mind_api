# Plan: proto/telemetry.proto

## Context
Define the gRPC contract for bidirectional telemetry streaming — the client sends a stream of `TelemetryData` samples and the server responds with a stream of `TelemetryAck` confirmations (or errors reusing `SessionErrorEvent` from `live.proto`).

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Proto definition

- [x] **Task 1: Create `proto/telemetry.proto`**
  Files: `proto/telemetry.proto`
  Create the proto file following the same conventions as `proto/live.proto`:
  - Header: `syntax = "proto3"; package mind;`
  - Import `google/protobuf/struct.proto` (for `google.protobuf.Struct`)
  - Import `live.proto` (for `SessionErrorEvent`)
  - **`TelemetryData`** message — client → server sample:
    - `string session_id = 1;`
    - `int64 timestamp = 2;` (Unix millis, same convention as `SessionErrorEvent.timestamp`)
    - `string module_id = 3;` (e.g. `"breath"`)
    - `string instruction_type = 4;` (module-defined, e.g. `"breath_phase"`)
    - `google.protobuf.Struct data = 5;` (intentionally untyped payload)
  - **`TelemetryAck`** message — server → client acknowledgement:
    - `string session_id = 1;`
    - `int64 received_count = 2;`
    - `int64 dropped_count = 3;`
    - `int32 max_samples_per_second = 4;`
    - `int64 timestamp = 5;`
  - **`TelemetryResponse`** oneof wrapper (same pattern as `LiveResponse`):
    - `TelemetryAck ack = 1;`
    - `SessionErrorEvent error = 2;` (imported from `live.proto`)
  - **`TelemetryService`** service:
    - `rpc StreamTelemetry(stream TelemetryData) returns (stream TelemetryResponse);`
  - Add section-separator comments (`// ---...`) matching the style in `live.proto`
