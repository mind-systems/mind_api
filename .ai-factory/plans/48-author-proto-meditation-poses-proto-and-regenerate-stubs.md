# Plan: Author `proto/meditation_poses.proto` and regenerate stubs

## Context
Introduce the gRPC contract for meditation poses so mobile can fetch pose UUIDs from the server: a new `proto/meditation_poses.proto` defining `MeditationPosesService.ListPoses`, plus its generated TypeScript stubs.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Proto contract

- [x] **Task 1: Create `proto/meditation_poses.proto`**
  Files: `proto/meditation_poses.proto`
  Add a new proto file following the conventions of `proto/bci_devices.proto` (empty-input pattern, `package mind`, `import "google/protobuf/empty.proto"`):
  - `syntax = "proto3";`, `package mind;`, import `google/protobuf/empty.proto`.
  - `message MeditationPose { string id = 1; string slug = 2; int32 display_order = 3; }`
  - `message ListMeditationPosesResponse { repeated MeditationPose poses = 1; }`
  - `service MeditationPosesService { rpc ListPoses(google.protobuf.Empty) returns (ListMeditationPosesResponse); }`
  Mirror the comment style used in `bci_devices.proto` (note that auth identity comes from metadata/interceptor, not the message — no auth concept in the proto itself). No timestamps, no user identity fields.

### Phase 2: Regenerate stubs

- [x] **Task 2: Regenerate gRPC stubs** (depends on Task 1)
  Files: `proto/generated/` (generated output — do not edit by hand)
  Run `npm run proto:gen` to regenerate stubs for all proto files. Verify that `proto/generated/` now contains TypeScript types for `MeditationPose`, `ListMeditationPosesResponse`, and the `MeditationPosesServiceController` interface (ts-proto `nestJs=true` output). Do not hand-edit any file under `proto/generated/`.
