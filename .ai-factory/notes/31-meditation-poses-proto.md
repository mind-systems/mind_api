# Meditation Poses — Proto Contract

**Date:** 2026-06-03
**Source:** conversation context

## Key Findings

- New service `MeditationPosesService` with a single `ListPoses` RPC — read-only, no mutations.
- `MeditationPose` message carries `id` (UUID string), `slug`, and `display_order` — no timestamps, no user identity.
- Input is `google.protobuf.Empty` — project convention from `bci_devices.proto` (`rpc List(google.protobuf.Empty)`).
- Modelled on `proto/bci_devices.proto` for the empty-input pattern; package/import style from `proto/nfb_calibration.proto`.

## Details

### File to create

`proto/meditation_poses.proto`

```proto
syntax = "proto3";
package mind;

import "google/protobuf/empty.proto";

service MeditationPosesService {
  rpc ListPoses(google.protobuf.Empty) returns (ListMeditationPosesResponse);
}

message MeditationPose {
  string id            = 1;
  string slug          = 2;
  int32  display_order = 3;
}

message ListMeditationPosesResponse {
  repeated MeditationPose poses = 1;
}
```

### Regeneration

```bash
npm run proto:gen
```

Stubs land in `proto/generated/`. Do not edit generated files by hand.

### Auth note

The proto itself has no auth concept. Auth is enforced at the controller level via `GrpcAuthInterceptor` — same pattern as all other services.

### How to verify

`proto/generated/` contains TypeScript types for `MeditationPose`, `ListMeditationPosesResponse`, and the `MeditationPosesServiceController` interface.

## Decisions

- **Cache strategy: re-fetch on every meditation module open.** No in-memory cache between opens; mobile calls `ListPoses` each time the meditation screen is entered. List is 6 rows — cost is negligible. Eliminates any staleness concern without TTL or versioning complexity. Additionally, new poses always require a new app release (localisation keys must be added to `kMeditationPoses`), so stale-cache is a theoretical problem, not a practical one.
