# BCI Devices — gRPC Contract (Final)

**Date:** 2026-05-21
**Source:** conversation context

## Key Findings

- The BCI device resource is **gRPC only** — no REST endpoints will be implemented.
- Proto service name: `BciDevicesService`. Three unary RPCs: `List`, `Register`, `Delete`.
- `Register` is idempotent: re-registering an already-paired serial bumps `updated_at` and returns the existing record — no error, no duplicate.
- No `alias` field — the entity stores only `id`, `serial`, `created_at`, `updated_at`.
- BCI device lists are **not** propagated through the sync changes journal — each phone manages its own pairing independently.

## Details

### Proto contract (`mind_api/proto/bci_devices.proto`)

```protobuf
syntax = "proto3";
package mind;

import "google/protobuf/empty.proto";

message BciDevice {
  string id         = 1;
  string serial     = 2;
  string created_at = 3;  // ISO-8601 string
  string updated_at = 4;  // ISO-8601 string
}

message ListBciDevicesResponse {
  repeated BciDevice devices = 1;
}

message RegisterBciDeviceRequest {
  string serial = 1;
}

message DeleteBciDeviceRequest {
  string id = 1;
}

service BciDevicesService {
  rpc List     (google.protobuf.Empty)      returns (ListBciDevicesResponse);
  rpc Register (RegisterBciDeviceRequest)   returns (BciDevice);
  rpc Delete   (DeleteBciDeviceRequest)     returns (google.protobuf.Empty);
}
```

Timestamps follow the project convention: ISO-8601 strings (same as `SyncEventDto.created_at`).

### RPC semantics

| RPC | Request | Response | Notes |
|-----|---------|----------|-------|
| `List` | `Empty` | `{ devices: BciDevice[] }` | Returns all devices for the authenticated user, ordered by `updated_at DESC` (most recently used first) |
| `Register` | `{ serial }` | `BciDevice` | Idempotent — if `(user_id, serial)` already exists, force-bumps `updated_at` to the current time and returns the reloaded record; otherwise inserts. Safe to call on every app start or BCI screen open. The bump must be explicit (`repo.update` with `CURRENT_TIMESTAMP`, or assign `updatedAt = new Date()` before `save`) — a plain `save(existingRow)` will not move the timestamp because TypeORM's `@UpdateDateColumn` only fires on detected changes. |
| `Delete` | `{ id }` | `Empty` | Removes the device. Returns `NOT_FOUND` if `id` does not exist, `PERMISSION_DENIED` if the device belongs to another user. |

### Authentication

Identity comes from the gRPC auth interceptor (JWT metadata), not from the request message itself. All three RPCs require a valid token — unauthenticated calls receive `UNAUTHENTICATED`.

### Database schema (`bci_devices` table)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | auto-generated |
| `user_id` | uuid NOT NULL | FK → `users.id` ON DELETE CASCADE |
| `serial` | varchar NOT NULL | hardware serial from `DeviceInfo.serial` |
| `created_at` | timestamptz | auto-set on insert |
| `updated_at` | timestamptz | auto-bumped on update (including idempotent re-register) |

Unique constraint on `(user_id, serial)`. Index on `user_id`.

### What is NOT implemented

- No `alias` field — dropped from the original spec.
- No REST endpoints — all access is via gRPC.
- No realtime stream integration — `last_connected_at` was replaced by the standard `updated_at` (bumped on each `Register` call).
- No sync journal entry — BCI device changes are not pushed to other devices via the sync stream.

## Open Questions

- Proto file not yet authored — coordinate with the mobile team before generating stubs on the mobile side. The final `.proto` lives in `mind_api/proto/` and will be published once Phase 16 is implemented.
