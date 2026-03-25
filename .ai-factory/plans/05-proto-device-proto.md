# Plan: proto/device.proto

## Context
Define the gRPC contract for the device ping endpoint — maps the existing `POST /device/ping` REST surface to a proto service so MCP and mobile consumers can use the same contract.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Proto contract

- [x] **Task 1: Create `proto/device.proto`**
  Files: `proto/device.proto`
  Create the proto file following the conventions established in `auth.proto`, `stats.proto`, and other existing protos:
  - `syntax = "proto3";` and `package mind;`
  - Define `PingRequest` message with these fields (field numbers in order):
    - `string installation_id = 1;`
    - `string platform = 2;`
    - `string os_version = 3;`
    - `string locale = 4;`
    - `string timezone = 5;`
    - `int32 screen_width = 6;`
    - `int32 screen_height = 7;`
    - `string app_version = 8;`
    - `string build_number = 9;`
    - `optional string model = 10;`
    - `optional string manufacturer = 11;`
  - Add a comment on `PingRequest` noting it maps to `DevicePingDto` in `src/device/dto/device-ping.dto.ts`.
  - Define an empty `PingResponse {}` message — follows the codebase convention where every RPC has a custom response type (no `google.protobuf.Empty` imports exist in this project). This also allows adding response fields later without a breaking contract change.
  - Define `DeviceService` with a single RPC: `rpc Ping(PingRequest) returns (PingResponse);`
  - Use the same comment style as the other proto files (section separators, DTO mapping notes).
