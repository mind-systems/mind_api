# Plan: Author `proto/bci_devices.proto` and regenerate stubs

## Context
Introduce the gRPC contract for the new BciDevice resource: a new `proto/bci_devices.proto` file modelled on `proto/sync.proto`, plus regenerated TypeScript stubs in `proto/generated/`. This unblocks the rest of Phase 16 (entity, service, controller).

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Proto contract

- [x] **Task 1: Create `proto/bci_devices.proto`**
  Files: `proto/bci_devices.proto`
  Author a new proto file following the structure and commenting style of `proto/sync.proto`:
  - Header: `syntax = "proto3";` + `package mind;`.
  - Import `google/protobuf/empty.proto`.
  - Section headers as comment banners ("Shared types", "Per-RPC request / response messages", "Service definition") matching `sync.proto`.
  - Entity message `BciDevice` with fields:
    - `string id = 1;`
    - `string serial = 2;`
    - `string created_at = 3;`
    - `string updated_at = 4;`
    Comment above it must explicitly note: maps to `BciDevice` entity in `src/bci/entities/bci-device.entity.ts`; `created_at`/`updated_at` are ISO-8601 strings to match the project convention used in `SyncEventDto` (`proto/sync.proto`).
  - Per-RPC messages (each preceded by a comment stating "Auth identity comes from metadata/interceptor, not the message", same convention as `GetChangesRequest` in `sync.proto`):
    - `ListBciDevicesResponse { repeated BciDevice devices = 1; }`
    - `RegisterBciDeviceRequest { string serial = 1; }`
    - `DeleteBciDeviceRequest { string id = 1; }`
  - Service definition with a comment banner summarizing the three RPCs (style of `sync.proto`'s service block):
    ```
    service BciDevicesService {
      rpc List(google.protobuf.Empty) returns (ListBciDevicesResponse);
      rpc Register(RegisterBciDeviceRequest) returns (BciDevice);
      rpc Delete(DeleteBciDeviceRequest) returns (google.protobuf.Empty);
    }
    ```
  - All three RPCs unary (no `stream` keyword).
  - Do NOT include any `user_id` / identity field in request messages — identity is supplied by `GrpcAuthInterceptor` via metadata, same as every other proto in this project.

- [x] **Task 2: Regenerate TypeScript stubs** (depends on Task 1)
  Files: `proto/generated/bci_devices.ts` (produced by codegen)
  Run `npm run proto:gen` from the `mind_api/` directory. This invokes `protoc` with the `ts-proto` plugin and writes the generated stub for the new proto alongside the existing files in `proto/generated/`. Verify that `proto/generated/bci_devices.ts` is present after the run. Do not hand-edit anything under `proto/generated/` — the directory is `.gitignore`d codegen output and any manual change will be overwritten on the next run.
